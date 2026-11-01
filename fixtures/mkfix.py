import hashlib, json, sys
A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58enc(b):
    n=int.from_bytes(b,'big'); s=''
    while n: n,r=divmod(n,58); s=A[r]+s
    return '1'*(len(b)-len(b.lstrip(b'\0')))+s
def b58dec(s):
    n=0
    for c in s: n=n*58+A.index(c)
    full=n.to_bytes((n.bit_length()+7)//8,'big')
    return b'\0'*(len(s)-len(s.lstrip('1')))+full
def stable(o):
    if isinstance(o,dict):
        items=[(k,o[k]) for k in sorted(o) if o[k] is not None]
        return '{'+','.join(json.dumps(k)+':'+stable(v) for k,v in items)+'}'
    if isinstance(o,list): return '['+','.join(stable(v) for v in o)+']'
    if isinstance(o,bool): return 'true' if o else 'false'
    return json.dumps(o)

PUB="ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"
open('spike/fixtures/pub.bin','wb').write(b58dec(PUB.split(':')[1]))

for src,name in (('quote.json','honest'),('worst_quote.json','worst')):
    r=json.load(open(src)); qr,qt=r['quoteRequest'],r['quote']
    nz=lambda v: v if v else None
    sreq={'dry':qr.get('dry'),'swapType':qr.get('swapType'),'slippageTolerance':qr.get('slippageTolerance'),
     'originAsset':qr.get('originAsset'),'depositType':qr.get('depositType'),'destinationAsset':qr.get('destinationAsset'),
     'amount':qr.get('amount'),'refundTo':qr.get('refundTo'),'refundType':qr.get('refundType'),
     'recipient':qr.get('recipient'),'recipientType':qr.get('recipientType'),'deadline':qr.get('deadline'),
     'quoteWaitingTimeMs':nz(qr.get('quoteWaitingTimeMs')),'referral':nz(qr.get('referral'))}
    squote={k:qt.get(k) for k in ('amountIn','amountInFormatted','amountInUsd','minAmountIn',
     'amountOut','amountOutFormatted','amountOutUsd','minAmountOut')}
    data=stable({**sreq,**squote,'timestamp':r['timestamp']}).encode()
    h=b58enc(hashlib.sha256(data).digest())
    open(f'spike/fixtures/{name}.canonical.json','wb').write(data)
    open(f'spike/fixtures/{name}.sig.bin','wb').write(b58dec(r['signature'].split(':')[1]))
    print(f'{name:7s} bytes={len(data):4d}  hash={h}')
