import { nelderMead } from './nelderMead.js';

/**
 * Starting guesses for the NSS parameters
 */
const THETA0_SEARCH_START =  0.04;  //  4% long-term rate
const THETA1_SEARCH_START = -0.01;  // -1% short-term component
const THETA2_SEARCH_START = -0.01;  // -1% medium-term hump
const THETA3_SEARCH_START =  0.01;  //  1% second hump
const LAMBDA1_SEARCH_START = 1.50;
const LAMBDA2_SEARCH_START = 3.00;

/**
 * Nelson-Siegel-Svensson curve function
 */
function nssCurve(tau, theta0, theta1, theta2, theta3, lambda1, lambda2) {
    // Safeguard: prevent division by zero
    // If tau is 0 or very close to 0, use a small positive value
    if (tau < 0.0001) {
        tau = 0.0001;
    }
    
    // Also ensure lambdas are not zero
    if (lambda1 <= 0.1) lambda1 = 0.11;
    if (lambda2 <= 0.1) lambda2 = 0.11;

    const term1 = theta0;
    const term2 = theta1 * ((1 - Math.exp(-tau/lambda1)) / (tau/lambda1));
    const term3 = theta2 * (((1 - Math.exp(-tau/lambda1)) / (tau/lambda1)) - Math.exp(-tau/lambda1));
    const term4 = theta3 * (((1 - Math.exp(-tau/lambda2)) / (tau/lambda2)) - Math.exp(-tau/lambda2));
    
    return term1 + term2 + term3 + term4;
}

/**
 * Calculates SSE between Market Price and Model Price (Discounted Cashflows)
 */
const calculateNSSErrors = (bonds) => {
    return (X) => {
        // Unpack parameters
        const [theta0, theta1, theta2, theta3, lambda1, lambda2] = X;

        // Constraints: Lambdas must be positive
        if (lambda1 <= 0.1 || lambda2 <= 0.1) return 1e9;

        let totalError = 0;

        // Loop through every bond in the market data
        for (const bond of bonds) {
            let modelPrice = 0;

            // Discount every cashflow using the NSS Spot Rate for that specific time t
            for (const cf of bond.cashflows) {
                const t = cf.term;
                
                // Get Spot Rate (r) for this specific cashflow timing
                // Note: nssCurve returns decimal rate (e.g. 0.045)
                const r = nssCurve(t, theta0, theta1, theta2, theta3, lambda1, lambda2);

                // Continuous Compounding Discounting: PV = CF * e^(-r*t)
                modelPrice += cf.amount * Math.exp(-r * t);
            }

            // Optimization Goal: Minimize Squared Price Error
            // Weighting: You might optionally weight by duration, but raw price error is standard
            totalError += Math.pow(bond.price - modelPrice, 2);
        }

        return totalError;
    };
};

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
 */
export async function fetchMarketData(env) {
    const { results } = await env.DB.prepare(`
        SELECT 
            p.cusip, p.security_type, s.issueDate, s.maturityDate,
            s.interestRate, s.interestPaymentFrequency,
            s.firstInterestPaymentDate, p.end_of_day as cleanPrice
        FROM securities s
        JOIN prices p ON s.cusip = p.cusip
        ORDER BY s.issueDate DESC
    `).all();

    if (!results || results.length === 0) throw new Error("No security data available.");

    const today = new Date();
    const marketData = [];

    for (const sec of results) {
        const issueDate = new Date(sec.issueDate);
        const maturity = new Date(sec.maturityDate);
        
        // Skip invalid dates
        if (isNaN(maturity.getTime()) || isNaN(issueDate.getTime())) continue;

        // Generate Cashflows & Pricing
        const { cashflows, dirtyPrice } = generateCashflowsAndPrice(sec, today);
        
        // Only include bonds that are currently active (have future cashflows)
        if (cashflows.length > 0) {
            marketData.push({
                cusip: sec.cusip,
                price: dirtyPrice, // We fit to the Dirty Price (Clean + Accrued)
                cashflows: cashflows // Array of { term, amount }
            });
        }
    }

    return marketData;
}

function generateCashflowsAndPrice(sec, today) {
    const faceValue = 100;
    const cleanPrice = parseFloat(sec.cleanPrice) || 0;
    const maturity = new Date(sec.maturityDate);
    const issueDate = new Date(sec.issueDate);
    const cashflows = [];
    let accruedInterest = 0;

    // Bill / Zero Coupon
    if (sec.interestPaymentFrequency === 'None' || sec.interestRate == null) {
        cashflows.push({
            date: maturity,
            term: calculateTerm(today, maturity),
            amount: faceValue,
            type: 'Principal'
        });
    } 
    // Note / Bond
    else {
        const couponRateAnnual = parseFloat(sec.interestRate) / 100;
        let frequency = 2; // Default Semi-Annual
        if (sec.interestPaymentFrequency === 'Annual') frequency = 1;
        else if (sec.interestPaymentFrequency === 'Quarterly') frequency = 4;
        else if (sec.interestPaymentFrequency === 'Monthly') frequency = 12;

        const couponAmount = (couponRateAnnual * faceValue) / frequency;
        
        // Generate Stream
        let nextPaymentDate = new Date(sec.firstInterestPaymentDate);
        if (isNaN(nextPaymentDate.getTime())) {
            const issueDay = issueDate.getDate();
            let newMonth = issueDate.getMonth() + (12 / frequency);
            let newYear = issueDate.getFullYear();
            
            while (newMonth >= 12) {
                newMonth -= 12;
                newYear += 1;
            }
            
            const lastDay = new Date(newYear, newMonth + 1, 0).getDate();
            nextPaymentDate = new Date(newYear, newMonth, Math.min(issueDay, lastDay));
        }

        const paymentDay = nextPaymentDate.getDate();
        const monthsToAdd = 12 / frequency;

        while (nextPaymentDate < maturity) {
            if (nextPaymentDate > today) {
                cashflows.push({
                    date: new Date(nextPaymentDate),
                    term: calculateTerm(today, nextPaymentDate),
                    amount: couponAmount,
                    type: 'Coupon'
                });
            }
            
            // Advance by the correct number of months
            let newMonth = nextPaymentDate.getMonth() + monthsToAdd;
            let newYear = nextPaymentDate.getFullYear();
            
            while (newMonth >= 12) {
                newMonth -= 12;
                newYear += 1;
            }
            
            // Create date with day 1 first
            let tempDate = new Date(newYear, newMonth, 1);
            // Get last day of this month
            let lastDay = new Date(newYear, newMonth + 1, 0).getDate();
            // Use the smaller of paymentDay or lastDay
            nextPaymentDate = new Date(newYear, newMonth, Math.min(paymentDay, lastDay));

        }

        cashflows.push({
            date: maturity,
            term: calculateTerm(today, maturity),
            amount: faceValue + couponAmount,
            type: 'Principal + Coupon'
        });

        // Calculate accrued interest by finding the last coupon payment date
        let periodStart = new Date(maturity);
        const periodDay = periodStart.getDate();
        const monthsToSubtract = 12 / frequency;

        // Work backward from maturity to find the period containing today
        while (periodStart > today) {
            let newMonth = periodStart.getMonth() - monthsToSubtract;
            let newYear = periodStart.getFullYear();
            
            while (newMonth < 0) {
                newMonth += 12;
                newYear -= 1;
            }
            
            let newPeriodStart = new Date(newYear, newMonth, Math.min(periodDay, new Date(newYear, newMonth + 1, 0).getDate()));
    
            // Don't go before issue date
            if (newPeriodStart < issueDate) {
                periodStart = issueDate;
                break;
            }
            
            periodStart = newPeriodStart;
        }

        let periodEnd;
        {
            let endMonth = periodStart.getMonth() + (12 / frequency);
            let endYear = periodStart.getFullYear();
            
            while (endMonth >= 12) {
                endMonth -= 12;
                endYear += 1;
            }
            
            const endLastDay = new Date(endYear, endMonth + 1, 0).getDate();
            periodEnd = new Date(endYear, endMonth, Math.min(periodDay, endLastDay));
        }

        const daysInPeriod = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
        const daysAccrued = (today - periodStart) / (1000 * 60 * 60 * 24);

        // Only calculate accrued if we're in a valid period
        if (daysInPeriod > 0 && daysAccrued >= 0 && daysAccrued <= daysInPeriod) {
            accruedInterest = couponAmount * (daysAccrued / daysInPeriod);
        }
    }

    return { cashflows, dirtyPrice: cleanPrice + accruedInterest };
}

function calculateTerm(referenceDate, targetDate) {
    return (targetDate - referenceDate) / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Calculates the initial NSS parameters by fitting the curve to DB data.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The fitted parameters.
 */
export async function getNSSParameters(env) {
    const values = await fetchMarketData(env);

    // For creating yield curve graph
    const allTerms = values.flatMap(b => b.cashflows.map(c => c.term));
    const maxMaturity = allTerms.length > 0 ? Math.max(...allTerms) : 30;

    const calculateErrors = calculateNSSErrors(values);

    const result = nelderMead(calculateErrors, [
        THETA0_SEARCH_START,
        THETA1_SEARCH_START,
        THETA2_SEARCH_START,
        THETA3_SEARCH_START,
        LAMBDA1_SEARCH_START,
        LAMBDA2_SEARCH_START,
    ], { 
        maxIterations: 10000,
        minErrorDelta: 1e-6 
    });

    return {
        theta0: result.x[0],
        theta1: result.x[1],
        theta2: result.x[2],
        theta3: result.x[3],
        lambda1: result.x[4],
        lambda2: result.x[5],
        squaredError: result.fx,
        iterations: result.iterations,
        dataPoints: values.length,
        maxMaturity: maxMaturity
    };
}

/**
 * Calculates the annualized spot rate for a specific time T.
 * Performs optimization first to ensure parameters are up to date with DB.
 * @param {number} t - Time in years.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The calculated spot rate and parameters used.
 */
export async function getSpotRate(t, params) {
    if (t < 0 || t > 30) throw new Error("Time T must be between 0 and 30 years.");

    // Calculate Spot Rate based on given NSS parameters
    const spotDecimal = nssCurve(
        t,
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2
    );

    return {
        t: t,
        spotRate: spotDecimal * 100, // Convert to Percentage
        type: "Zero-Coupon Spot Rate",
        parameters: params
    };
}

export async function getYieldCurve(numPoints = 100, params, env) {
    if (numPoints < 0 || numPoints > 100) {
        throw new Error("Number of points must be between 0 and 100");
    }

    // 2. Define Curve Bounds
    const minMaturity = 0.01;
    const maxMaturity = params.maxMaturity;
    
    const step = maxMaturity / (numPoints - 1);
    const curve = [];

    // 3. Generate Points using the fitted Spot parameters
    for (let i = 0; i < numPoints; i++) {
        const t = minMaturity + (i * step);

        const spotDecimal = nssCurve(
            t,
            params.theta0,
            params.theta1,
            params.theta2,
            params.theta3,
            params.lambda1,
            params.lambda2
        );

        if (!isFinite(spotDecimal)) continue;

        curve.push({
            maturity: t,
            rate: spotDecimal * 100 // Return as %
        });
    }
    
    return {
        curveType: "Spot / Zero-Coupon",
        curve: curve,
        parameters: params
    };
}