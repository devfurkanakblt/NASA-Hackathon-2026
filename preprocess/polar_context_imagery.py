from pathlib import Path
from preprocess.lunar_imagery import fetch_photo,WAC,sha256_bytes
from PIL import Image
import json,numpy as np
p=Path('public/assets/moon-south-context.jpg');site={'id':'SouthContext','latDeg':-90.,'lonDeg':0.}
photo,meta=fetch_photo(site,2000000,WAC,Path('data_raw/lunar-imagery'),pixels=4096)
assert (photo.alpha>=.999).all()
Image.fromarray(photo.pixels.astype('uint8')).save(p,quality=95,optimize=True)
p.with_suffix('.json').write_text(json.dumps({'version':1,'file':p.name,'sha256':sha256_bytes(p.read_bytes()),'width':4096,'height':4096,'bounds':meta['bounds'],'source':meta,'archiveShadows':True,'frame':'Moon south stereographic R1737400 north at image top','limitations':['Archival WAC photographic lighting; not selected UTC','Context photograph, not fine DEM geometry']},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'bytes':p.stat().st_size,'bounds':meta['bounds']}))
