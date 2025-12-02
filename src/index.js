import { renderHtml } from "./renderHtml";

// Cloudflare Worker to fetch and populate TreasuryDirect data into D1
// Deploy this worker and call the /populate endpoint to enrich your database

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route 1: Populate data from TreasuryDirect API
      if (path === '/populate') {
        return await populateTreasuryData(env, corsHeaders);
      }

      // Route 2: Check population status
      if (path === '/status') {
        const { results } = await env.DB.prepare(`
          SELECT 
            COUNT(*) as total,
            COUNT(td_issue_date) as enriched,
            COUNT(*) - COUNT(td_issue_date) as pending
          FROM securities
        `).all();
        return Response.json(results[0], { headers: corsHeaders });
      }

      // Route 3: Get all securities
      if (path === '/securities') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices LIMIT 100'
        ).all();
        return Response.json(results);
      }

      // Route 4: Get security by CUSIP
      if (path.startsWith('/security/')) {
        const cusip = path.split('/')[2];
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices WHERE cusip = ?'
        ).bind(cusip).all();
        return Response.json(results[0] || { error: 'Not found' }, { headers: corsHeaders });
      }

      // Route 5: Get securities by type
      if (path === '/type') {
        const type = url.searchParams.get('t');
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices WHERE security_type = ?'
        ).bind(type).all();
        return Response.json(results);
      }

      // Route 6: Get statistics
      if (path === '/stats') {
        const { results } = await env.DB.prepare(`
          SELECT 
            security_type,
            COUNT(*) as count,
            AVG(coupon_rate) as avg_coupon,
            AVG(price_2) as avg_price
          FROM security_prices 
          GROUP BY security_type
        `).all();
        return Response.json(results);
      }

      // Default: API info
      return Response.json({
        endpoints: {
          '/populate': 'Fetch and populate TreasuryDirect data (POST)',
          '/status': 'Check enrichment status',
          '/securities': 'Get all securities (limit 100)',
          '/security/{cusip}': 'Get full security details by CUSIP',
          '/type?t={type}': 'Get securities by type',
          '/stats': 'Get statistics by security type'
        },
        note: 'Call /populate to start enriching data from TreasuryDirect API'
      }, { headers: corsHeaders });

    } catch (error) {
      return Response.json({ 
        error: error.message,
        stack: error.stack 
      }, { 
        status: 500,
        headers: corsHeaders 
      });
    }
  }
};

// Function to fetch data from TreasuryDirect API
async function fetchTreasuryData(cusip) {
  const url = `https://www.treasurydirect.gov/TA_WS/securities/search?cusip=${cusip}&format=json`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Cloudflare-Worker',
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    if (data && data.length > 0) {
      // Return the most recent issue (first in array)
      return data[0];
    }
    return null;
  } catch (error) {
    console.error(`Error fetching ${cusip}:`, error);
    return null;
  }
}

// Function to populate all securities with TreasuryDirect data
async function populateTreasuryData(env, corsHeaders) {
  // Get all CUSIPs that haven't been enriched yet
  const { results: securities } = await env.DB.prepare(`
    SELECT cusip FROM securities 
    WHERE td_issue_date IS NULL
    LIMIT 50
  `).all();

  if (securities.length === 0) {
    return Response.json({
      message: 'All securities already enriched',
      processed: 0
    }, { headers: corsHeaders });
  }

  let processed = 0;
  let failed = 0;
  const errors = [];

  for (const security of securities) {
    const cusip = security.cusip;
    
    try {
      // Fetch data from TreasuryDirect
      const treasuryData = await fetchTreasuryData(cusip);
      
      if (treasuryData) {
        // Update database with enriched data
        await env.DB.prepare(`
          UPDATE securities SET
            td_issue_date = ?,
            td_security_type = ?,
            td_security_term = ?,
            td_maturity_date = ?,
            td_interest_rate = ?,
            td_announcement_date = ?,
            td_auction_date = ?,
            td_dated_date = ?,
            td_adjusted_price = ?,
            td_average_median_yield = ?,
            td_bid_to_cover_ratio = ?,
            td_callable = ?,
            td_competitive_accepted = ?,
            td_competitive_tendered = ?,
            td_corpus_cusip = ?,
            td_currently_outstanding = ?,
            td_first_interest_payment_date = ?,
            td_floating_rate = ?,
            td_high_price = ?,
            td_high_yield = ?,
            td_low_yield = ?,
            td_offering_amount = ?,
            td_price_per_100 = ?,
            td_reopening = ?,
            td_series = ?,
            td_strippable = ?,
            td_term = ?,
            td_tips = ?,
            td_total_accepted = ?,
            td_total_tendered = ?,
            td_type = ?,
            td_interest_payment_frequency = ?,
            td_ref_cpi_on_issue_date = ?,
            td_index_ratio_on_issue_date = ?,
            td_allocation_percentage = ?,
            td_updated_timestamp = ?
          WHERE cusip = ?
        `).bind(
          treasuryData.issueDate,
          treasuryData.securityType,
          treasuryData.securityTerm,
          treasuryData.maturityDate,
          treasuryData.interestRate,
          treasuryData.announcementDate,
          treasuryData.auctionDate,
          treasuryData.datedDate,
          treasuryData.adjustedPrice,
          treasuryData.averageMedianYield,
          treasuryData.bidToCoverRatio,
          treasuryData.callable,
          treasuryData.competitiveAccepted,
          treasuryData.competitiveTendered,
          treasuryData.corpusCusip,
          treasuryData.currentlyOutstanding,
          treasuryData.firstInterestPaymentDate,
          treasuryData.floatingRate,
          treasuryData.highPrice,
          treasuryData.highYield,
          treasuryData.lowYield,
          treasuryData.offeringAmount,
          treasuryData.pricePer100,
          treasuryData.reopening,
          treasuryData.series,
          treasuryData.strippable,
          treasuryData.term,
          treasuryData.tips,
          treasuryData.totalAccepted,
          treasuryData.totalTendered,
          treasuryData.type,
          treasuryData.interestPaymentFrequency,
          treasuryData.refCpiOnIssueDate,
          treasuryData.indexRatioOnIssueDate,
          treasuryData.allocationPercentage,
          treasuryData.updatedTimestamp,
          cusip
        ).run();
        
        processed++;
      } else {
        failed++;
        errors.push({ cusip, error: 'No data returned from API' });
      }
      
      // Rate limiting - be nice to the API
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      failed++;
      errors.push({ cusip, error: error.message });
    }
  }

  return Response.json({
    message: 'Population batch complete',
    processed,
    failed,
    remaining: securities.length - processed,
    errors: errors.slice(0, 5), // Show first 5 errors
    note: failed > 0 ? 'Some securities could not be enriched. Call /populate again to retry.' : 'Call /populate again to process more securities'
  }, { headers: corsHeaders });
}
