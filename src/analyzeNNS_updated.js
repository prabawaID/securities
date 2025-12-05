import { nelderMead } from './nelderMead.js';
import { fetchMarketDataWithYields } from './bondYieldCalculator.js';

// --- Configuration ---

// Starting guesses for the NSS parameters
const THETA0_SEARCH_START = 0.05;
const THETA1_SEARCH_START = -0.01;  // Often negative for Treasury curves
const THETA2_SEARCH_START = 0.0;
const THETA3_SEARCH_START = 0.0;
const LAMBDA1_SEARCH_START = 1.5;   // Adjusted to typical range
const LAMBDA2_SEARCH_START = 3.0;   // Adjusted to typical range

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * Now uses actual yield-from-price calculations instead of assuming par.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
 */
async function fetchMarketData(env) {
    // Use the enhanced function that calculates yields from prices
    return await fetchMarketDataWithYields(env);
}

/**
 * Calculates the Sum of Squared Errors (SSE) between model and market yields.
 */
const createErrorFunction = (values) => {
    return (X) => {
        const theta0 = X[0];
        const theta1 = X[1];
        const theta2 = X[2];
        const theta3 = X[3];
        const lambda1 = X[4];
        const lambda2 = X[5];

        // Constraint: Lambdas must be positive and reasonable
        // Typical ranges: lambda1 in [0.5, 3], lambda2 in [2, 10]
        if (lambda1 <= 0.1 || lambda1 > 5.0 || lambda2 <= 0.5 || lambda2 > 15.0) {
            return 1e9;
        }

        let runningError = 0;

        for (let i = 0; i < values.length; i++) {
            const t = values[i].term;
            const marketYield = values[i].yield / 100; // Convert percentage to decimal

            // Handle very short maturities to avoid division by zero
            if (t < 0.001) continue;

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

    if (values.length < 6) {
        throw new Error(`Insufficient data points for NSS fitting: ${values.length} found, need at least 6`);
    }

    const calculateErrors = createErrorFunction(values);

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
        rmse: Math.sqrt(result.fx / values.length), // Root Mean Square Error
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
    if (t < 0.001 || t > 30) {
        throw new Error("Time T must be between 0.001 and 30 years.");
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

/**
 * Calculate the entire yield curve for a range of maturities
 * Useful for visualization and analysis
 * @param {Object} env - Worker environment
 * @param {number} minTerm - Minimum term in years (default 0.25)
 * @param {number} maxTerm - Maximum term in years (default 30)
 * @param {number} step - Step size in years (default 0.25)
 * @returns {Promise<Object>} - Yield curve data and parameters
 */
export async function getYieldCurve(env, minTerm = 0.25, maxTerm = 30, step = 0.25) {
    const params = await getNSSParameters(env);
    
    const curve = [];
    for (let t = minTerm; t <= maxTerm; t += step) {
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

        curve.push({
            term: t,
            rate: ratePercent
        });
    }

    return {
        curve: curve,
        parameters: params
    };
}
