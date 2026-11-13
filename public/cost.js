/* Shared browser/Node estimator. USD; estimates are not billing limits. */
(function(root) {
  function estimate({ groups, engines, reps, web, models, options }) {
    const count = groups.reduce((n, g) => n + g.count, 0);
    const calls = count * engines.length * reps;
    if (!calls) return { low: 0, high: 0, calls: 0, judgeCalls: 0, missing: [] };
    let low = 0, high = 0;
    const missing = [];
    const price = role => (options[role] || []).find(x => x.id === models[role]);
    for (const engine of engines) {
      const p = price(engine);
      if (!p || ![p.input,p.output,...(web?[p.search]:[])].every(Number.isFinite)) { missing.push(engine); continue; }
      const n = count * reps;
      low += n * (((web ? 3000 : 300) * p.input + 800 * p.output) / 1e6 + (web ? p.search / 1000 : 0));
      high += n * (((web ? 18000 : 1500) * p.input + 3000 * p.output) / 1e6 + (web ? 3 * p.search / 1000 : 0));
    }
    // Current judge batches are per group, engine, repetition, max 8 answers each.
    const judgeCalls = groups.reduce((n, g) => n + Math.ceil(g.count / 8), 0) * engines.length * reps;
    const judgeLowCalls = groups.filter(g=>g.id==='B').reduce((n,g)=>n+Math.ceil(g.count/8),0)*engines.length*reps;
    const p = price('judge');
    if (!p || ![p.input,p.output].every(Number.isFinite)) missing.push('judge');
    else { low += judgeLowCalls * (4000*p.input+800*p.output)/1e6; high += judgeCalls*(18000*p.input+2500*p.output)/1e6; }
    return { low: missing.length ? null : low, high: missing.length ? null : high, calls, judgeCalls, missing };
  }
  root.CheckAICost = { estimate };
})(globalThis);
