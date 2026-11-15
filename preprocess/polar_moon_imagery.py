from pathlib import Path
from preprocess.lunar_imagery import fetch_photo,NAC,WAC,sha256_bytes
from PIL import Image
import json,numpy as np
cache=Path('data_raw/lunar-imagery');site={'id':'SouthPole','latDeg':-90.,'lonDeg':0.}
base,b=fetch_photo(site,380000,WAC,cache,pixels=3072)
high,h=fetch_photo(site,380000,NAC,cache,pixels=3072)
a=high.alpha>=.999; out=np.where(a,high.pixels,base.pixels).astype('uint8')
p=Path('public/assets/moon-south-polar.jpg');Image.fromarray(out).save(p,quality=95,optimize=True)
m={'version':1,'file':p.name,'sha256':sha256_bytes(p.read_bytes()),'width':3072,'height':3072,'source':[b,h],'bounds':h['bounds'],'frame':'south polar stereographic R1737400, x east at 90E, y toward 0E','archiveShadows':True,'limitations':['Archival NAC average lighting, not selected UTC','WAC fills missing NAC pixels; photographic detail is limited by delivered source grid']}
p.with_suffix('.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps({'bounds':h['bounds'],'bytes':p.stat().st_size}))
