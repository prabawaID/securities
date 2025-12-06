// Simple Nelder-Mead optimization
function nelderMead(objective, initial, bounds, options = {}) {
    const maxIter = options.maxIter || 10000;
    const tol = options.tol || 1e-8;
    const alpha = 1.0;  // reflection
    const gamma = 2.0;  // expansion
    const rho = 0.5;    // contraction
    const sigma = 0.5;  // shrink
    
    const n = initial.length;
    
    // Apply bounds
    function clipToBounds(x) {
        return x.map((val, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], val)));
    }
    
    // Initialize simplex
    let simplex = [clipToBounds([...initial])];
    for (let i = 0; i < n; i++) {
        const vertex = [...initial];
        vertex[i] += (bounds[i][1] - bounds[i][0]) * 0.05;
        simplex.push(clipToBounds(vertex));
    }
    
    // Evaluate initial simplex
    let values = simplex.map(x => objective(x));
    
    for (let iter = 0; iter < maxIter; iter++) {
        // Sort simplex by function values
        const indices = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
        simplex = indices.map(i => simplex[i]);
        values = indices.map(i => values[i]);
        
        // Check convergence
        const range = values[n] - values[0];
        if (range < tol) {
            console.log(`Converged after ${iter} iterations`);
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
    
    return simplex[0];
}