import { pool } from './src/services/db/pool';
const r = await pool.query(`
  SELECT se.id, se.session_id, se.kind, se.created_at, se.payload
  FROM session_events se
  JOIN sessions s ON s.id = se.session_id
  WHERE s.workspace_id = 'qq16592c'
    AND se.kind = 'tool_call'
    AND se.payload::text LIKE '%skill-bilingual-doc-review/references/gitlab-pending-comments.md%'
  ORDER BY se.created_at
`);
console.log("tool_call count", r.rows.length);
for (const row of r.rows) {
  const p = row.payload;
  const name = p.name || '';
  let argSummary = '';
  try {
    const args = JSON.parse(p.arguments || '{}');
    if (name.startsWith('Edit')) {
      argSummary = `op=${args.command||args.op||'?'} keys=${Object.keys(args).join(',')}`;
    } else if (name === 'execute') {
      argSummary = 'CMD: ' + JSON.stringify(args.command||args.cmd||args).slice(0,160);
    } else if (name === 'read') {
      argSummary = 'read';
    } else {
      argSummary = 'keys=' + Object.keys(args).join(',');
    }
  } catch(e) { argSummary = '(parse fail) '+String(p.arguments).slice(0,120); }
  // only show mutating ones
  if (name === 'read') continue;
  console.log(row.created_at, '|', row.session_id.slice(0,8), '|', name.slice(0,55), '|', argSummary.slice(0,170));
}
await pool.end();
