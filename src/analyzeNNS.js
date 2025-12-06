import { nelderMead } from './nelderMead.js';

// --- Configuration ---

// Starting guesses for the NSS parameters
const THETA0_SEARCH_START =  0.04;  // 4% long-term rate
const THETA1_SEARCH_START = -0.01;  // -2% short-term component
const THETA2_SEARCH_START = -0.01;  // 1% medium-term hump
const THETA3_SEARCH_START =  0.01;  // -0.5% second hump
const LAMBDA1_SEARCH_START = 1.50;
const LAMBDA2_SEARCH_START = 3.00;

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
    const { results } = await env.DB.prepare(`
        SELECT p.cusip, p.security_type, s.highYield, s.highInvestmentRate, s.maturityDate
        FROM (
            SELECT
                *,
                ROW_NUMBER() OVER (PARTITION BY cusip ORDER BY issueDate DESC) as rn
            FROM securities
        ) s, prices p
        WHERE
            s.cusip = p.cusip AND
            rn = 1
    `).all();

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
        if (term < 0.000) continue;

        // Ensure yield is a number (handle string inputs if DB returns strings)
        let yieldVal;
        
        if (sec.security_type == 'MARKET BASED BILL')
            yieldVal = parseFloat(sec.highInvestmentRate);
        else
            yieldVal = parseFloat(sec.highYield);

        if (isNaN(yieldVal)) continue;

        marketData.push({ term: term, yield: yieldVal });
    }

    // Sort by term
    marketData.sort((a, b) => a.term - b.term);
    return marketData;
}

// Nelson-Siegel-Svensson curve function
function nssCurve(tau, theta0, theta1, theta2, theta3, lambda1, lambda2) {
    // Safeguard: prevent division by zero
    // If tau is 0 or very close to 0, use a small positive value
    if (tau < 0.0001) {
        tau = 0.0001;
    }
    
    // Also ensure lambdas are not zero
    if (lambda1 <= 0) lambda1 = 0.1;
    if (lambda2 <= 0) lambda2 = 0.1;

    const term1 = theta0;
    const term2 = theta1 * ((1 - Math.exp(-tau/lambda1)) / (tau/lambda1));
    const term3 = theta2 * (((1 - Math.exp(-tau/lambda1)) / (tau/lambda1)) - Math.exp(-tau/lambda1));
    const term4 = theta3 * (((1 - Math.exp(-tau/lambda2)) / (tau/lambda2)) - Math.exp(-tau/lambda2));
    
    return term1 + term2 + term3 + term4;
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

            const modelYield = nssCurve(
                t,
                params.theta0,
                params.theta1,
                params.theta2,
                params.theta3,
                params.lambda1,
                params.lambda2);

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

    const yieldDecimal = nssCurve(
        t,
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2);

    // Validate the rate to catch any calculation errors
    if (!isFinite(yieldDecimal) || isNaN(yieldDecimal)) {
        console.warn(`Invalid yield at maturity ${t}: ${yieldDecimal}`);
    }

    const ratePercent = yieldDecimal * 100;

    return {
        t: t,
        spotRate: ratePercent,
        parameters: params
    };
}

export async function getYieldCurve(numPoints = 100, env) {
    if (numPoints < 0 || numPoints > 100) {
        throw new Error("Number of points must be between 0 and 100");
    }

    const marketData = await fetchMarketData(env);

    // Get fresh parameters
    const params = await getNSSParameters(env);

    // Generate curve points
    const minMaturity = 0.01;
    const maxMaturity = Math.max(...marketData.map(d => d.term));
    const step = maxMaturity / (numPoints - 1);
    
    const curve = [];
    for (let i = 0; i < numPoints; i++) {
        const t = minMaturity + (i * step);

        const yieldDecimal = nssCurve(
            t,
            params.theta0,
            params.theta1,
            params.theta2,
            params.theta3,
            params.lambda1,
            params.lambda2);

        // Validate the rate to catch any calculation errors
        if (!isFinite(yieldDecimal) || isNaN(yieldDecimal)) {
            console.warn(`Invalid yield at maturity ${t}: ${yieldDecimal}`);
            // Skip invalid points rather than including nulls
            continue;
        }
 
        const ratePercent = yieldDecimal * 100;

        curve.push({
            maturity: t,
            rate: ratePercent
        });
    }
    
    return {
        curve: curve,
        parameters: {
            theta0: params.theta0,
            theta1: params.theta1,
            theta2: params.theta2,
            theta3: params.theta3,
            lambda1: params.lambda1,
            lambda2: params.lambda2,
            rmse: params.squaredError,
            iterations: params.iterations,
            dataPoints: marketData.length
        }
    };
}