import { parseDate, formatDate, getNextBusinessDay, isBusinessDay } from './dateHelper.js';
import { 
    calculatePricing,
    getPaymentFrequency,
    getFrequencyName 
} from './bondCalculations.js';

/**
 * Analyzes a US Treasury security by CUSIP.
 * Includes logic for accrued interest, dirty price, and issue selection.
 */
export async function analyzeCusip(cusip, settlementDateStr, issuePreference = 'latest', env) {
    try {
        // Validate CUSIP
        const cusipValidation = validateCUSIP(cusip);
        if (!cusipValidation.valid) {
            return {
                error: cusipValidation.error,
                cusip,
                suggestion: 'CUSIP should be 9 characters (e.g., 912828ZG8)'
            };
        }

        // Get base price
        const { results: prices } = await env.DB.prepare(
            'SELECT * FROM prices WHERE cusip = ?'
        ).bind(cusip).all();

        if (!prices || prices.length === 0) {
            return {
                error: `CUSIP ${cusip} not found in database`,
                cusip,
                suggestion: 'Please verify the CUSIP is correct'
            };
        }

        const price = prices[0];

        // Get all issues for this CUSIP
        const { results: issues } = await env.DB.prepare(
            'SELECT * FROM securities WHERE cusip = ? ORDER BY issueDate DESC'
        ).bind(cusip).all();

        if (!issues || issues.length === 0) {
            return {
                error: `No issue information found for CUSIP ${cusip}`,
                cusip,
                price_found: true
            };
        }

        // Determine which issue to use
        let selectedIssue;
        if (issuePreference === 'original') {
            selectedIssue = issues[issues.length - 1]; // Oldest issue
        } else {
            selectedIssue = issues[0]; // Latest issue (default)
        }

        // Determine settlement date
        const today = new Date();
        let settlementDate = getNextBusinessDay(today);

        if (settlementDateStr) {
            let dateFromAIModel = parseDate(settlementDateStr);
            if (!dateFromAIModel || isNaN(dateFromAIModel.getTime())) {
                return {
                    error: `Invalid settlement date: ${settlementDateStr}`,
                    cusip,
                    suggestion: 'Use format YYYY-MM-DD'
                };
            }

            if (dateFromAIModel > settlementDate) {
                settlementDate = dateFromAIModel;
            }
        }

        // Prepare pricing parameters
        const couponRate = parseFloat(price.rate || selectedIssue?.interestRate || 0);
        const cleanPrice = parseFloat(selectedIssue?.pricePer100 || price.buy || 0);
        const maturityDate = parseDate(price.maturity_date || selectedIssue?.maturityDate);
        const firstCouponDate = selectedIssue?.firstInterestPaymentDate
            ? parseDate(selectedIssue.firstInterestPaymentDate)
            : null;
        const frequency = getPaymentFrequency(selectedIssue?.interestPaymentFrequency);

        // Calculate pricing using shared function
        const analysis = calculatePricing({
            cleanPrice: cleanPrice,
            couponRate: couponRate / 100, // Convert to decimal
            securityType: price.security_type,
            maturityDate: maturityDate,
            referenceDate: settlementDate,
            firstCouponDate: firstCouponDate,
            frequency: frequency
        });

        return {
            success: true,
            cusip,
            issue_count: issues.length,
            issue_summary: issues.map(i => ({
                issue_date: i.issueDate,
                auction_date: i.auctionDate,
                reopening: i.reopening,
                total_accepted: i.totalAccepted,
                bid_to_cover_ratio: i.bidToCoverRatio
            })),
            selected_issue: {
                issue_date: selectedIssue?.issueDate,
                auction_date: selectedIssue?.auctionDate,
                reopening: selectedIssue?.reopening,
                which: issuePreference === 'original' ? 'Original Issue' : 'Most Recent Issue'
            },
            price_info: {
                cusip: price.cusip,
                security_type: price.security_type,
                coupon_rate: couponRate,
                maturity_date: price.maturity_date || selectedIssue?.maturityDate,
                clean_price: cleanPrice,

                // From selected issue
                issue_date: selectedIssue?.issueDate,
                first_coupon_date: selectedIssue?.firstInterestPaymentDate,
                payment_frequency: selectedIssue?.interestPaymentFrequency || 'Semi-Annual',
                dated_date: selectedIssue?.datedDate,
                tips: selectedIssue?.tips === 'Yes',
                callable: selectedIssue?.callable === 'Yes',
                high_yield: selectedIssue?.highYield,
                bid_to_cover: selectedIssue?.bidToCoverRatio
            },
            settlement_info: {
                today: formatDate(today),
                settlement_date: formatDate(settlementDate),
                is_t_plus_1: !settlementDateStr,
                is_business_day: isBusinessDay(settlementDate)
            },
            pricing: analysis,
            calculations: analysis.calculation_details
        };

    } catch (error) {
        return {
            error: `Error analyzing CUSIP: ${error.message}`,
            cusip,
            ...(env.ENVIRONMENT === 'development' && { stack: error.stack })
        };
    }
}

// --- Helper Functions ---

function validateCUSIP(cusip) {
    /**
     * Validate CUSIP format (9 characters: 6 letters/digits + 2 digits + 1 check digit)
     */
    if (!cusip || typeof cusip !== 'string') {
        return { valid: false, error: 'CUSIP must be a string' };
    }

    if (cusip.length !== 9) {
        return { valid: false, error: 'CUSIP must be exactly 9 characters' };
    }

    const pattern = /^[0-9]{5}[0-9A-Z]{3}[0-9]$/;
    if (!pattern.test(cusip)) {
        return { valid: false, error: 'Invalid CUSIP format' };
    }

    return { valid: true };
}
