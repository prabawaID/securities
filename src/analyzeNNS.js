import { nelderMead } from './nelderMead.js';

// --- Configuration ---

// Starting guesses for the NSS parameters
const THETA0_SEARCH_START =  0.040;  // 4% long-term rate
const THETA1_SEARCH_START = -0.020;  // -2% short-term component
const THETA2_SEARCH_START =  0.010;  // 1% medium-term hump
const THETA3_SEARCH_START = -0.005;  // -0.5% second hump
const LAMBDA1_SEARCH_START = 1.000;
const LAMBDA2_SEARCH_START = 1.000;

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
 */
async function fetchMarketData(env) {
    // We select securities that have a valid interest rate and maturity date.
    // We assume the 'securities' table contains active issues.
    // We use the interestRate as the yield proxy (assuming par for simplicity in this context,
    // or that the table data represents the yield curve points).
    const { results } = await env.DB.prepare(
        'SELECT maturityDate, highYield FROM securities WHERE maturityDate IS NOT NULL AND highYield IS NOT NULL'
    ).all();

    if (!results || results.length === 0) {
        throw new Error("No security data available to build yield curve.");
    }

    const today = new Date();
    const marketData = [];

    for (const sec of results) {
        const maturity = new Date(sec.maturityDate);
        if (isNaN(maturity.getTime())) continue;

        // Calculate time to maturity in years (ACT/365 approximation for curve fitting)
        const diffTime = maturity - today;
        const term = diffTime / (1000 * 60 * 60 * 24 * 365.25);

        // Filter out expired or extremely short-term bonds if necessary
        if (term <= 0.001) continue;

        // Ensure yield is a number (handle string inputs if DB returns strings)
        let yieldVal = parseFloat(sec.highYield);
        if (isNaN(yieldVal)) continue;

        marketData.push({ term: term, yield: yieldVal });
    }

    // Sort by term
    marketData.sort((a, b) => a.term - b.term);
    return marketData;
}

/**
 * Calculates the Sum of Squared Errors (SSE) between model and market yields.
 */
const calculateNSSErrors = (values) => {
    return (X) => {
        const theta0 = X[0];
        const theta1 = X[1];
        const theta2 = X[2];
        const theta3 = X[3];
        const lambda1 = X[4];
        const lambda2 = X[5];

        // Constraint: Lambdas must be positive to ensure convergence
        if (lambda1 <= 0.05 || lambda2 <= 0.05) {
            return 1e9; // Penalty for invalid parameters
        }

        let runningError = 0;

        for (let i = 0; i < values.length; i++) {
            const t = values[i].term;
            const marketYield = values[i].yield / 100;

            const term1 = t / lambda1;
            const term2 = t / lambda2;
            const exp1 = Math.exp(-term1);
            const exp2 = Math.exp(-term2);

            const factor1 = (1 - exp1) / term1;
            const factor2 = factor1 - exp1;
            const factor3 = ((1 - exp2) / term2) - exp2;

            const modelYield = theta0 + (theta1 * factor1) + (theta2 * factor2) + (theta3 * factor3);
            runningError += Math.pow(marketYield - modelYield, 2);
        }

        return runningError;
    };
};

/**
 * Calculates the initial NSS parameters by fitting the curve to DB data.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The fitted parameters.
 */
export async function getNSSParameters(env) {
    const values = await fetchMarketData(env);

    const calculateErrors = calculateNSSErrors(values);

    const result = nelderMead(calculateErrors, [
        THETA0_SEARCH_START,
        THETA1_SEARCH_START,
        THETA2_SEARCH_START,
        THETA3_SEARCH_START,
        LAMBDA1_SEARCH_START,
        LAMBDA2_SEARCH_START,
    ]);

    return {
        theta0: result.x[0],
        theta1: result.x[1],
        theta2: result.x[2],
        theta3: result.x[3],
        lambda1: result.x[4],
        lambda2: result.x[5],
        squaredError: result.fx,
        iterations: result.iterations,
        dataPoints: values.length
    };
}

/**
 * Calculates the annualized spot rate for a specific time T.
 * Performs optimization first to ensure parameters are up to date with DB.
 * @param {number} t - Time in years.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The calculated spot rate and parameters used.
 */
export async function calculateSpotRate(t, env) {
    if (t < 0 || t > 30) {
        throw new Error("Time T must be between 0 and 30 years.");
    }

    // Get fresh parameters
    const params = await getNSSParameters(env);

    const b0 = params.theta0;
    const b1 = params.theta1;
    const b2 = params.theta2;
    const b3 = params.theta3;
    const t1 = params.lambda1;
    const t2 = params.lambda2;

    const term1 = t / t1;
    const term2 = t / t2;
    const exp1 = Math.exp(-term1);
    const exp2 = Math.exp(-term2);

    const factor1 = (1 - exp1) / term1;
    const factor2 = factor1 - exp1;
    const factor3 = ((1 - exp2) / term2) - exp2;

    const yieldDecimal = b0 + (b1 * factor1) + (b2 * factor2) + (b3 * factor3);
    const ratePercent = yieldDecimal * 100;

    return {
        t: t,
        spotRate: ratePercent,
        parameters: params
    };
}