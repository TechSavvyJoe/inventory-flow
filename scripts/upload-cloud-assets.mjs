import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon','.json':'application/json'}
const manifest=JSON.parse(readFileSync(path.join(root,'runtime/cloud-assets-manifest.json'),'utf8'))
const buckets=JSON.parse(readFileSync(path.join(root,'runtime/cloud-assets-buckets.json'),'utf8'))
const token=process.env.CLOUDFLARE_ASSET_UPLOAD_JWT
if(!token) throw new Error('Protected asset upload authorization is missing')
const byHash=new Map(Object.entries(manifest).map(([file,meta])=>[meta.hash,file]))
for(const hashes of buckets) {
  const form=new FormData()
  for(const hash of hashes) {
    const file=byHash.get(hash)
    if(!file || file.includes('..')) throw new Error('Unknown asset')
    const value=readFileSync(path.join(root,'dist',file))
    if(createHash('sha256').update(value).digest('hex').slice(0,32)!==hash) throw new Error('Build changed during deployment')
    form.append(hash,new Blob([value.toString('base64')],{type:types[path.extname(file)]}),hash)
  }
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/c7d37a87f560c6eac566c62db586288d/workers/assets/upload?base64=true',{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${token}`},body:form})
  if(!response.ok) throw new Error(`Asset upload failed (${response.status})`)
  // Completion tokens are deliberately discarded. The connected deployment
  // API obtains a new completion token from the now-complete manifest.
  await response.body?.cancel()
}
console.log(`Frontend assets uploaded: ${Object.keys(manifest).length} files; credentials not displayed.`)
