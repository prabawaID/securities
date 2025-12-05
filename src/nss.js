import { nelderMead } from './nelderMead.js';

/**
 * Fetches and cleans market data from the D1 database.
 * @param {D1Database} db 
 * @returns {Promise<Array<{term: number, yield: number}>>} Sorted array of term/yield pairs
 */
export async function getMarketData(db) {
    const query = `
        SELECT highYield, issueDate, maturityDate 
        FROM securities 
        WHERE highYield IS NOT NULL 
          AND highYield != 'None' 
          AND issueDate IS NOT NULL 
          AND maturityDate IS NOT NULL
    `;
    
    const { results } = await db.prepare(query).all();

    if (!results || results.length < 6) {
        throw new Error(`Insufficient data points for NSS calibration. Found ${results ? results.length : 0}, need at least 6.`);
    }

    const values = [];
    
    for (const row of results) {
        const yieldVal = parseFloat(row.highYield);
        const issueDate = new Date(row.issueDate);
        const maturityDate = new Date(row.maturityDate);

        // Calculate Term in Years
        const diffTime = Math.abs(maturityDate - issueDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        const termInYears = diffDays / 365.25;

        // Filter out bad data (negative terms, extreme yields)
        if (!isNaN(yieldVal) && !isNaN(termInYears) && termInYears > 0.01) {
            values.push({
                term: termInYears,
                yield: yieldVal
            });
        }
    }

    // Sort by term (Required for Heuristic Guesses)
    values.sort((a, b) => a.term - b.term);
    return values;
}

/**
 * Generates initial parameter guesses based on market data heuristics.
 * @param {Array<{term: number, yield: number}>} values - Sorted market data
 * @returns {Object} The 6 NSS parameters
 */
export function generateInitialGuesses(values) {
    if (!values || values.length === 0) {
        throw new Error("Cannot generate guesses: Market data is empty.");
    }

    const shortPoint = values[0];
    const longPoint = values[values.length - 1];

    // beta0: Long term level (approx 30y rate)
    const theta0 = longPoint.yield;
    
    // beta1: Short term spread (Short Rate - Long Rate)
    // Formula: y(0) = beta0 + beta1 => beta1 = y(0) - beta0
    const theta1 = shortPoint.yield - theta0;
    
    // beta2, beta3: Curvature (Start neutral)
    const theta2 = 0.0;
    const theta3 = 0.0;
    
    // lambdas: Decay factors (Standard financial modeling starts)
    const lambda1 = 1.5; 
    const lambda2 = 10.0;

    return { theta0, theta1, theta2, theta3, lambda1, lambda2 };
}

/**
 * Calculates the annualized spot rate for a given time T using the Nelson-Siegel-Svensson model.
 * Fetches current market data from the DB to calibrate the curve.
 * @param {D1Database} db - The Cloudflare D1 Database binding
 * @param {number} targetT - The time to maturity in years to calculate the rate for
 * @returns {Promise<number>} - The calculated yield in percent
 */
export async function calculateSpotRate(db, targetT) {
    // 1. Fetch Data
    const values = await getMarketData(db);

    // 2. Generate Initial Guesses
    const guesses = generateInitialGuesses(values);

    // 3. Define Error Function for Nelder-Mead
    const calculateNSSErrors = (X) => {
        const theta0 = X[0];
        const theta1 = X[1];
        const theta2 = X[2];
        const theta3 = X[3];
        const lambda1 = X[4];
        const lambda2 = X[5];

        // Constraint Penalties: Lambdas must be positive and distinct
        if (lambda1 <= 0.1 || lambda2 <= 0.1 || Math.abs(lambda1 - lambda2) < 0.1) {
            return 1e9; 
        }

        let runningError = 0;

        for (let i = 0; i < values.length; i++) {
            const t = values[i].term;
            const marketYield = values[i].yield; // Keep in percentage for stability

            // NSS Terms
            const term1 = t / lambda1;
            const term2 = t / lambda2;
            const exp1 = Math.exp(-term1);
            const exp2 = Math.exp(-term2);

            const factor1 = (1 - exp1) / term1;
            const factor2 = factor1 - exp1;
            const factor3 = ((1 - exp2) / term2) - exp2;

            const modelYield = theta0 + (theta1 * factor1) + (theta2 * factor2) + (theta3 * factor3);

            // Sum Squared Error
            runningError += Math.pow(marketYield - modelYield, 2);
        }

        return runningError;
    };

    // 4. Run Optimization
    const result = nelderMead(calculateNSSErrors, [
        guesses.theta0,
        guesses.theta1,
        guesses.theta2,
        guesses.theta3,
        guesses.lambda1,
        guesses.lambda2,
    ]);

    const bestParams = {
        b0: result.x[0],
        b1: result.x[1],
        b2: result.x[2],
        b3: result.x[3],
        t1: result.x[4],
        t2: result.x[5]
    };

    // 5. Calculate Spot Rate for Target T
    if (targetT <= 0.001) {
        return bestParams.b0 + bestParams.b1;
    }

    const t = targetT;
    const t1 = bestParams.t1;
    const t2 = bestParams.t2;

    const term1 = t / t1;
    const term2 = t / t2;
    const exp1 = Math.exp(-term1);
    const exp2 = Math.exp(-term2);

    const factor1 = (1 - exp1) / term1;
    const factor2 = factor1 - exp1;
    const factor3 = ((1 - exp2) / term2) - exp2;

    const calculatedYield = bestParams.b0 + (bestParams.b1 * factor1) + (bestParams.b2 * factor2) + (bestParams.b3 * factor3);
    
    return calculatedYield;
}