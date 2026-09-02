import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root=fileURLToPath(new URL('..',import.meta.url)), dist=path.join(root,'dist')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon','.json':'application/json'}
const manifest={}, files={}
function walk(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name)
    if(entry.isDirectory()) {walk(file);continue}
    if(!Object.hasOwn(types,path.extname(file))) throw new Error('Unapproved build artifact type')
    const value=readFileSync(file), hash=createHash('sha256').update(value).digest('hex').slice(0,32)
    manifest['/'+path.relative(dist,file).split(path.sep).join('/')]={hash,size:value.length}
    files[hash]={type:types[path.extname(file)],data:value.toString('base64')}
  }
}
walk(dist)
mkdirSync(path.join(root,'runtime'),{recursive:true})
const payload=Buffer.from(JSON.stringify({manifest,files}))
writeFileSync(path.join(root,'runtime/cloud-assets-manifest.json'),JSON.stringify(manifest))
writeFileSync(path.join(root,'runtime/cloud-assets-payload.b64'),gzipSync(payload).toString('base64'))
console.log(JSON.stringify({files:Object.keys(manifest).length,bytes:payload.length,encodedBytes:gzipSync(payload).toString('base64').length}))
