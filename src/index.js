import { renderHtml } from "./renderHtml";

// Example Cloudflare Worker to query the D1 database
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route: Get all securities
      if (path === '/securities') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices LIMIT 100'
        ).all();
        return Response.json(results);
      }

      // Route: Get security by CUSIP
      if (path.startsWith('/security/')) {
        const cusip = path.split('/')[2];
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices WHERE cusip = ?'
        ).bind(cusip).all();
        return Response.json(results[0] || { error: 'Not found' });
      }

      // Route: Get securities by type
      if (path === '/type') {
        const type = url.searchParams.get('t');
        const { results } = await env.DB.prepare(
          'SELECT * FROM security_prices WHERE security_type = ?'
        ).bind(type).all();
        return Response.json(results);
      }

      // Route: Get statistics
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

      // Default: API documentation
      return Response.json({
        endpoints: {
          '/securities': 'Get all securities (limit 100)',
          '/security/{cusip}': 'Get security by CUSIP',
          '/type?t={type}': 'Get securities by type',
          '/stats': 'Get statistics by security type'
        }
      });

    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
};
