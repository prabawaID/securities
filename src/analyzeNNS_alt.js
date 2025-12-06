// NSS Curve Calculator Class
// Integrated implementation for Cloudflare Workers environment

class NSSCurveCalculator {
    constructor() {
        this.params = null;
        this.maturities = [];
        this.yields = [];
    }
    
    // Nelson-Siegel-Svensson curve function
    nssCurve(tau, beta0, beta1, beta2, beta3, lambda1, lambda2) {
        const term1 = beta0;
        const term2 = beta1 * ((1 - Math.exp(-tau/lambda1)) / (tau/lambda1));
        const term3 = beta2 * (((1 - Math.exp(-tau/lambda1)) / (tau/lambda1)) - Math.exp(-tau/lambda1));
        const term4 = beta3 * (((1 - Math.exp(-tau/lambda2)) / (tau/lambda2)) - Math.exp(-tau/lambda2));
        
        return term1 + term2 + term3 + term4;
    }
    
    // Calculate objective function (sum of squared errors)
    objective(params, maturities, yields) {
        const [beta0, beta1, beta2, beta3, lambda1, lambda2] = params;
        let sumSquaredErrors = 0;
        
        for (let i = 0; i < maturities.length; i++) {
            const predicted = this.nssCurve(maturities[i], beta0, beta1, beta2, beta3, lambda1, lambda2);
            const error = yields[i] - predicted;
            sumSquaredErrors += error * error;
        }
        
        return sumSquaredErrors;
    }
    
    // Nelder-Mead optimization
    nelderMead(objective, initial, bounds, options = {}) {
        const maxIter = options.maxIter || 10000;
        const tol = options.tol || 1e-8;
        const alpha = 1.0;  // reflection
        const gamma = 2.0;  // expansion
        const rho = 0.5;    // contraction
        const sigma = 0.5;  // shrink
        
        const n = initial.length;
        
        // Apply bounds
        const clipToBounds = (x) => {
            return x.map((val, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], val)));
        };
        
        // Initialize simplex
        let simplex = [clipToBounds([...initial])];
        for (let i = 0; i < n; i++) {
            const vertex = [...initial];
            vertex[i] += (bounds[i][1] - bounds[i][0]) * 0.05;
            simplex.push(clipToBounds(vertex));
        }
        
        // Evaluate initial simplex
        let values = simplex.map(x => objective(x));
        let iterations = 0;
        
        for (let iter = 0; iter < maxIter; iter++) {
            iterations = iter + 1;
            
            // Sort simplex by function values
            const indices = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
            simplex = indices.map(i => simplex[i]);
            values = indices.map(i => values[i]);
            
            // Check convergence
            const range = values[n] - values[0];
            if (range < tol) {
                break;
            }
            
            // Calculate centroid (excluding worst point)
            const centroid = new Array(n).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    centroid[j] += simplex[i][j] / n;
                }
            }
            
            // Reflection
            const reflected = centroid.map((c, i) => c + alpha * (c - simplex[n][i]));
            const reflectedClipped = clipToBounds(reflected);
            const reflectedVal = objective(reflectedClipped);
            
            if (reflectedVal < values[n - 1] && reflectedVal >= values[0]) {
                simplex[n] = reflectedClipped;
                values[n] = reflectedVal;
                continue;
            }
            
            // Expansion
            if (reflectedVal < values[0]) {
                const expanded = centroid.map((c, i) => c + gamma * (reflectedClipped[i] - c));
                const expandedClipped = clipToBounds(expanded);
                const expandedVal = objective(expandedClipped);
                
                if (expandedVal < reflectedVal) {
                    simplex[n] = expandedClipped;
                    values[n] = expandedVal;
                } else {
                    simplex[n] = reflectedClipped;
                    values[n] = reflectedVal;
                }
                continue;
            }
            
            // Contraction
            const contracted = centroid.map((c, i) => c + rho * (simplex[n][i] - c));
            const contractedClipped = clipToBounds(contracted);
            const contractedVal = objective(contractedClipped);
            
            if (contractedVal < values[n]) {
                simplex[n] = contractedClipped;
                values[n] = contractedVal;
                continue;
            }
            
            // Shrink
            for (let i = 1; i <= n; i++) {
                simplex[i] = simplex[i].map((x, j) => simplex[0][j] + sigma * (x - simplex[0][j]));
                simplex[i] = clipToBounds(simplex[i]);
                values[i] = objective(simplex[i]);
            }
        }
        
        return {
            x: simplex[0],
            fx: values[0],
            iterations: iterations
        };
    }
    
    // Load data from array of {term, yield} objects
    loadData(marketData) {
        this.maturities = marketData.map(d => d.term);
        this.yields = marketData.map(d => d.yield / 100); // Convert percentage to decimal
        
        return {
            count: marketData.length,
            maturityRange: [Math.min(...this.maturities), Math.max(...this.maturities)],
            yieldRange: [Math.min(...this.yields), Math.max(...this.yields)]
        };
    }
    
    // Fit the NSS curve
    fit(options = {}) {
        if (this.maturities.length === 0) {
            throw new Error('No data loaded. Call loadData() first.');
        }
        
        // Create objective function with data
        const objFunc = (params) => this.objective(params, this.maturities, this.yields);
        
        // Initial parameters
        const initial = options.initial || [0.04, -0.01, -0.01, 0.01, 1.5, 3.0];
        
        // Bounds for parameters
        const bounds = options.bounds || [
            [0.00, 0.15],      // beta0
            [-0.15, 0.15],     // beta1
            [-0.15, 0.15],     // beta2
            [-0.15, 0.15],     // beta3
            [0.1, 10.0],       // lambda1
            [0.1, 20.0]        // lambda2
        ];
        
        // Optimize
        const result = this.nelderMead(objFunc, initial, bounds, { 
            maxIter: options.maxIter || 10000, 
            tol: options.tol || 1e-8
        });
        
        this.params = result.x;
        
        const [beta0, beta1, beta2, beta3, lambda1, lambda2] = this.params;
        
        // Calculate RMSE
        let sumSquaredErrors = 0;
        for (let i = 0; i < this.maturities.length; i++) {
            const predicted = this.nssCurve(this.maturities[i], beta0, beta1, beta2, beta3, lambda1, lambda2);
            const error = this.yields[i] - predicted;
            sumSquaredErrors += error * error;
        }
        const rmse = Math.sqrt(sumSquaredErrors / this.maturities.length);
        
        return {
            beta0,
            beta1,
            beta2,
            beta3,
            lambda1,
            lambda2,
            squaredError: result.fx,
            rmse,
            iterations: result.iterations
        };
    }
    
    // Get spot rate for a given maturity
    getSpotRate(maturity) {
        if (!this.params) {
            throw new Error('Curve not fitted. Call fit() first.');
        }
        
        const [beta0, beta1, beta2, beta3, lambda1, lambda2] = this.params;
        return this.nssCurve(maturity, beta0, beta1, beta2, beta3, lambda1, lambda2);
    }
}

// --- Configuration ---

// Starting guesses for the NSS parameters
const THETA0_SEARCH_START =  0.04;  // 4% long-term rate
const THETA1_SEARCH_START = -0.01;  // -1% short-term component
const THETA2_SEARCH_START = -0.01;  // -1% medium-term hump
const THETA3_SEARCH_START =  0.01;  // 1% second hump
const LAMBDA1_SEARCH_START = 1.50;
const LAMBDA2_SEARCH_START = 3.00;

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
 */
async function fetchMarketData(env) {
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

        // Filter out expired securities
        if (term <= 0) continue;

        // Ensure yield is a number (handle string inputs if DB returns strings)
        let yieldVal;
        
        if (sec.security_type === 'MARKET BASED BILL') {
            yieldVal = parseFloat(sec.highInvestmentRate);
        } else {
            yieldVal = parseFloat(sec.highYield);
        }

        if (isNaN(yieldVal)) continue;

        marketData.push({ term: term, yield: yieldVal });
    }

    // Sort by term
    marketData.sort((a, b) => a.term - b.term);
    return marketData;
}

/**
 * Calculates the NSS parameters by fitting the curve to DB data.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The fitted parameters.
 */
export async function getNSSParameters(env) {
    const marketData = await fetchMarketData(env);
    
    const calculator = new NSSCurveCalculator();
    calculator.loadData(marketData);
    
    const fitResults = calculator.fit({
        initial: [
            THETA0_SEARCH_START,
            THETA1_SEARCH_START,
            THETA2_SEARCH_START,
            THETA3_SEARCH_START,
            LAMBDA1_SEARCH_START,
            LAMBDA2_SEARCH_START,
        ],
        maxIter: 10000,
        tol: 1e-8
    });

    return {
        theta0: fitResults.beta0,
        theta1: fitResults.beta1,
        theta2: fitResults.beta2,
        theta3: fitResults.beta3,
        lambda1: fitResults.lambda1,
        lambda2: fitResults.lambda2,
        squaredError: fitResults.squaredError,
        rmse: fitResults.rmse,
        iterations: fitResults.iterations,
        dataPoints: marketData.length
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
    
    // Create calculator instance with the fitted parameters
    const calculator = new NSSCurveCalculator();
    calculator.params = [
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2
    ];
    
    // Calculate spot rate (returned as decimal, convert to percentage)
    const spotRateDecimal = calculator.getSpotRate(t);
    const ratePercent = spotRateDecimal * 100;

    return {
        t: t,
        spotRate: ratePercent,
        parameters: params
    };
}

/**
 * Get the full yield curve for a range of maturities.
 * @param {Object} env - Worker environment.
 * @param {number} numPoints - Number of points to generate (default: 100).
 * @returns {Promise<Object>} - Array of {maturity, rate} and parameters.
 */
export async function getYieldCurve(env, numPoints = 100) {
    const marketData = await fetchMarketData(env);

    // Get fresh parameters
    const params = await getNSSParameters(env);
    
    // Create calculator instance with the fitted parameters
    const calculator = new NSSCurveCalculator();
    calculator.params = [
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2
    ];
    
    // Generate curve points
    const maxMaturity = Math.max(...marketData.map(d => d.term));
    const step = maxMaturity / (numPoints - 1);
    
    const curve = [];
    for (let i = 0; i < numPoints; i++) {
        const maturity = i * step;
        const rate = calculator.getSpotRate(maturity) * 100; // Convert to percentage
        curve.push({
            maturity: maturity,
            rate: rate
        });
    }
    
    return {
        curve: curve,
        parameters: {
            theta0: params.beta0,
            theta1: params.beta1,
            theta2: params.beta2,
            theta3: params.beta3,
            lambda1: params.lambda1,
            lambda2: params.lambda2,
            rmse: params.rmse,
            iterations: params.iterations,
            dataPoints: marketData.length
        }
    };
}
