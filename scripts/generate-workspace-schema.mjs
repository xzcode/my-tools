import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const server = await createServer({ server:{ middlewareMode:true }, appType:'custom' });
try {
  const { tools } = await server.ssrLoadModule('/src/core/catalog.ts');
  const schema = Object.fromEntries(tools.map(tool=>[tool.id,{
    actions:tool.actions.map(a=>a.id),
    options:Object.fromEntries(tool.options.filter(o=>['select','number','checkbox'].includes(o.type)).map(o=>[o.key,
      o.type==='select'?{type:'select',values:o.choices.map(c=>c.value)}:o.type==='number'?{type:'number',min:o.min??0,max:o.max??100000}:{type:'checkbox'}]))
  }]));
  writeFileSync('src-tauri/src/workspace_options.json', JSON.stringify(schema,null,2)+'\n');
} finally { await server.close(); }
