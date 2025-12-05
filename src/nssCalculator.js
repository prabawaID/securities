// nssCalculator.js - Nelson-Siegel-Svensson Curve Fitting Module
import { nelderMead } from './nelderMead.js';

// Default initial parameters for NSS optimization
const DEFAULT_INITIAL_PARAMS = {
    theta0: 0.05,   // β0 - Long-term factor
    theta1: 0.0,    // β1 - Short-term factor
    theta2: 0.0,    // β2 - Mid-term hump factor 1
    theta3: 0.0,    // β3 - Mid-term hump factor 2
    lambda1: 1.0,   // τ1 - Decay factor 1
    lambda2: 1.0    // τ2 - Decay factor 2
};

/**
 * Get initial NSS parameters (starting guesses for optimization)
 * @returns {Object} Initial parameters for NSS curve fitting
 */
export function getInitialNSSParameters() {
    return {
        success: true,
        description: 'Initial parameters for Nelson-Siegel-Svensson curve fitting',
        parameters: {
            theta0: DEFAULT_INITIAL_PARAMS.theta0,
            theta1: DEFAULT_INITIAL_PARAMS.theta1,
            theta2: DEFAULT_INITIAL_PARAMS.theta2,
            theta3: DEFAULT_INITIAL_PARAMS.theta3,
            lambda1: DEFAULT_INITIAL_PARAMS.lambda1,
            lambda2: DEFAULT_INITIAL_PARAMS.lambda2
        },
        explanation: {
            theta0: 'β₀ - Long-term interest rate level (asymptotic value)',
            theta1: 'β₁ - Short-term component (decays to zero)',
            theta2: 'β₂ - Medium-term component (hump at medium maturity)',
            theta3: 'β₃ - Second medium-term component (additional flexibility)',
            lambda1: 'τ₁ - Decay rate for short/medium term (controls where hump occurs)',
            lambda2: 'τ₂ - Second decay rate (controls second hump position)'
        }
    };
}

/**
 * Fetch market data from securities table for NSS curve fitting
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} asOfDate - Optional date for filtering (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of {term, yield} objects
 */
export async function fetchMarketData(env, asOfDate = null) {
    try {
        // Query to get distinct securities with their yields
        // We'll use the most recent prices and calculate time to maturity
        const query = `
            SELECT 
                s.cusip,
                s.maturityDate,
                s.issueDate,
                p.couponRate,
                p.askPrice,
                p.bidPrice
            FROM securities s
            JOIN prices p ON s.cusip = p.cusip
            GROUP BY s.cusip
            ORDER BY s.maturityDate ASC
        `;

        const { results } = await env.DB.prepare(query).all();

        if (!results || results.length === 0) {
            throw new Error('No market data found in database');
        }

        // Calculate time to maturity and yield for each security
        const referenceDate = asOfDate ? new Date(asOfDate) : new Date();
        const marketData = [];

        for (const row of results) {
            const maturityDate = new Date(row.maturityDate);
            const yearsToMaturity = (maturityDate - referenceDate) / (1000 * 60 * 60 * 24 * 365.25);
            
            // Only include securities with positive time to maturity
            if (yearsToMaturity > 0 && yearsToMaturity <= 30) {
                // Use coupon rate as proxy for yield (for par securities)
                // In reality, you'd calculate YTM, but for curve fitting, coupon rate is reasonable
                const yieldValue = parseFloat(row.couponRate) / 100;
                
                marketData.push({
                    cusip: row.cusip,
                    term: yearsToMaturity,
                    yield: yieldValue,
                    maturityDate: row.maturityDate
                });
            }
        }

        // Sort by term
        marketData.sort((a, b) => a.term - b.term);

        return marketData;

    } catch (error) {
        console.error('Error fetching market data:', error);
        throw error;
    }
}

/**
 * Calculate NSS yield for a given maturity using fitted parameters
 * @param {number} t - Time to maturity in years
 * @param {Object} params - NSS parameters {theta0, theta1, theta2, theta3, lambda1, lambda2}
 * @returns {number} Annualized spot rate (as decimal, e.g., 0.045 for 4.5%)
 */
export function calculateNSSYield(t, params) {
    const { theta0, theta1, theta2, theta3, lambda1, lambda2 } = params;

    // Avoid division by zero
    if (t <= 0) {
        return theta0 + theta1;
    }

    const term1 = t / lambda1;
    const term2 = t / lambda2;
    
    const exp1 = Math.exp(-term1);
    const exp2 = Math.exp(-term2);

    // NSS formula components
    const factor1 = (1 - exp1) / term1;
    const factor2 = factor1 - exp1;
    const factor3 = ((1 - exp2) / term2) - exp2;

    const yield_decimal = theta0 + (theta1 * factor1) + (theta2 * factor2) + (theta3 * factor3);

    return yield_decimal;
}

/**
 * Calculate Sum of Squared Errors for NSS curve fitting
 * @param {Array} X - Parameters array [theta0, theta1, theta2, theta3, lambda1, lambda2]
 * @param {Array} marketData - Array of {term, yield} objects
 * @returns {number} Sum of squared errors
 */
function calculateNSSErrors(X, marketData) {
    const theta0 = X[0];
    const theta1 = X[1];
    const theta2 = X[2];
    const theta3 = X[3];
    const lambda1 = X[4];
    const lambda2 = X[5];

    // Constraint: Lambdas must be positive
    if (lambda1 <= 0.05 || lambda2 <= 0.05) {
        return 1e9; // Penalty for invalid parameters
    }

    let runningError = 0;

    for (let i = 0; i < marketData.length; i++) {
        const t = marketData[i].term;
        const marketYield = marketData[i].yield;

        const modelYield = calculateNSSYield(t, { theta0, theta1, theta2, theta3, lambda1, lambda2 });

        // Sum squared error
        runningError += Math.pow(marketYield - modelYield, 2);
    }

    return runningError;
}

/**
 * Fit NSS curve to market data and calculate spot rate for a given maturity
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} targetMaturity - Target maturity in years (e.g., 7.5)
 * @param {Object} options - Optional parameters {asOfDate, initialParams}
 * @returns {Promise<Object>} Fitted parameters and calculated spot rate
 */
export async function calculateSpotRate(env, targetMaturity, options = {}) {
    try {
        // Validate input
        if (targetMaturity <= 0 || targetMaturity > 30) {
            return {
                error: 'Target maturity must be between 0 and 30 years',
                targetMaturity
            };
        }

        // Fetch market data
        const marketData = await fetchMarketData(env, options.asOfDate);

        if (marketData.length < 6) {
            return {
                error: 'Insufficient market data for curve fitting (need at least 6 points)',
                dataPoints: marketData.length
            };
        }

        // Initial parameters
        const initialParams = options.initialParams || [
            DEFAULT_INITIAL_PARAMS.theta0,
            DEFAULT_INITIAL_PARAMS.theta1,
            DEFAULT_INITIAL_PARAMS.theta2,
            DEFAULT_INITIAL_PARAMS.theta3,
            DEFAULT_INITIAL_PARAMS.lambda1,
            DEFAULT_INITIAL_PARAMS.lambda2
        ];

        console.log('Starting NSS curve fitting with', marketData.length, 'data points...');

        // Optimize using Nelder-Mead
        const objectiveFunction = (X) => calculateNSSErrors(X, marketData);
        const result = nelderMead(objectiveFunction, initialParams, {
            maxIterations: 1000,
            minErrorDelta: 1e-8,
            minTolerance: 1e-7
        });

        // Extract fitted parameters
        const fittedParams = {
            theta0: result.x[0],
            theta1: result.x[1],
            theta2: result.x[2],
            theta3: result.x[3],
            lambda1: result.x[4],
            lambda2: result.x[5]
        };

        // Calculate spot rate for target maturity
        const spotRate = calculateNSSYield(targetMaturity, fittedParams);

        return {
            success: true,
            targetMaturity,
            spotRate: spotRate * 100, // Convert to percentage
            spotRateDecimal: spotRate,
            fittedParameters: fittedParams,
            optimizationInfo: {
                iterations: result.iterations,
                finalError: result.fx,
                dataPoints: marketData.length
            },
            marketDataSummary: {
                minMaturity: Math.min(...marketData.map(d => d.term)).toFixed(2),
                maxMaturity: Math.max(...marketData.map(d => d.term)).toFixed(2),
                securities: marketData.length
            }
        };

    } catch (error) {
        return {
            error: `Spot rate calculation failed: ${error.message}`,
            targetMaturity,
            stack: error.stack
        };
    }
}

/**
 * Fit NSS curve and return complete yield curve (for visualization or analysis)
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {Object} options - Optional parameters {asOfDate, initialParams, maturities}
 * @returns {Promise<Object>} Fitted parameters and yield curve points
 */
export async function fitNSSCurve(env, options = {}) {
    try {
        // Fetch market data
        const marketData = await fetchMarketData(env, options.asOfDate);

        if (marketData.length < 6) {
            return {
                error: 'Insufficient market data for curve fitting (need at least 6 points)',
                dataPoints: marketData.length
            };
        }

        // Initial parameters
        const initialParams = options.initialParams || [
            DEFAULT_INITIAL_PARAMS.theta0,
            DEFAULT_INITIAL_PARAMS.theta1,
            DEFAULT_INITIAL_PARAMS.theta2,
            DEFAULT_INITIAL_PARAMS.theta3,
            DEFAULT_INITIAL_PARAMS.lambda1,
            DEFAULT_INITIAL_PARAMS.lambda2
        ];

        console.log('Fitting NSS curve to', marketData.length, 'data points...');

        // Optimize
        const objectiveFunction = (X) => calculateNSSErrors(X, marketData);
        const result = nelderMead(objectiveFunction, initialParams, {
            maxIterations: 1000,
            minErrorDelta: 1e-8,
            minTolerance: 1e-7
        });

        // Extract fitted parameters
        const fittedParams = {
            theta0: result.x[0],
            theta1: result.x[1],
            theta2: result.x[2],
            theta3: result.x[3],
            lambda1: result.x[4],
            lambda2: result.x[5]
        };

        // Generate yield curve at specified maturities
        const maturities = options.maturities || [
            0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30
        ];

        const yieldCurve = maturities.map(t => ({
            maturity: t,
            spotRate: calculateNSSYield(t, fittedParams) * 100 // percentage
        }));

        return {
            success: true,
            fittedParameters: fittedParams,
            yieldCurve,
            marketData: marketData.map(d => ({
                term: d.term,
                yield: d.yield * 100,
                cusip: d.cusip
            })),
            optimizationInfo: {
                iterations: result.iterations,
                finalError: result.fx,
                dataPoints: marketData.length
            }
        };

    } catch (error) {
        return {
            error: `NSS curve fitting failed: ${error.message}`,
            stack: error.stack
        };
    }
}
