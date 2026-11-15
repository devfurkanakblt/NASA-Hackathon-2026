"""Photographic registration tests use analytic fixture rasters, not production textures."""
import numpy as np
import pytest
from affine import Affine
from rasterio.io import MemoryFile

from preprocess import lunar_imagery as m


def site(latitude=-89.4632, longitude=-137.49):
    return dict(id="Site01",latDeg=latitude,lonDeg=longitude,surfaceElevationM=100,observerHeightM=2)


def test_polar_regional_crop_contains_interior_pole_and_observer():
    s=site()
    srs,crs=m.source_projection(s)
    assert srs=="IAU2000:30120"
    bounds=m.crop_bounds(s,240000,crs,3072)
    assert bounds[0]<0<bounds[2] and bounds[1]<0<bounds[3]
    x,y=m.Transformer.from_crs(m.LONLAT,crs,always_xy=True).transform(s['lonDeg'],s['latDeg'])
    assert bounds[0]<x<bounds[2] and bounds[1]<y<bounds[3]


@pytest.mark.parametrize("latitude",[-41.6385,.67416])
def test_nonpolar_source_uses_moon_geographic(latitude):
    srs,crs=m.source_projection(site(latitude,23))
    assert srs=="IAU2000:30100"
    assert m.CRS.from_user_input(crs).ellipsoid.semi_major_metre==1737400


def test_bilinear_raster_pixel_centres_and_missing_alpha():
    data=np.arange(25,dtype=float).reshape(5,5)
    alpha=np.full((5,5),255,dtype=np.uint8)
    raster=m.PhotoRaster(data,alpha,Affine(10,0,-25,0,-10,25),m.STEREO)
    values,mask=raster.sample(np.array([-20.,-15.]),np.array([20.,15.]))
    np.testing.assert_allclose(values,[0,3])
    assert mask.all()
    alpha[1,1]=0
    raster=m.PhotoRaster(data,alpha,Affine(10,0,-25,0,-10,25),m.STEREO)
    _,mask=raster.sample(np.array([-15.]),np.array([15.]))
    assert not mask[0]


def test_target_is_north_at_top_and_registered_in_true_enu():
    n=40;cell=100
    x=-2000+(np.arange(n)+.5)*cell
    y=2000-(np.arange(n)+.5)*cell
    xx,yy=np.meshgrid(x,y)
    raster=m.PhotoRaster(100+.02*xx+.01*yy,np.full((n,n),255),Affine(cell,0,-2000,0,-cell,2000),m.STEREO)
    image,mask,fractions=m.resample_enu(site(-90,0),1600,16,[raster],rows=3)
    ee,nn=np.meshgrid(-800+(np.arange(16)+.5)*100,800-(np.arange(16)+.5)*100)
    expected=100+.02*ee+.01*nn
    np.testing.assert_allclose(image,expected,atol=.51)
    assert mask.all() and fractions==[1]
    assert image[0,0]>image[-1,0] and image[0,-1]>image[0,0]


def test_unobserved_pixels_are_not_invented():
    empty=m.PhotoRaster(np.full((40,40),128),np.zeros((40,40)),Affine(100,0,-2000,0,-100,2000),m.STEREO)
    image,mask,fractions=m.resample_enu(site(-90,0),1600,16,[empty])
    assert not mask.any() and fractions==[0]
    assert not image.any()


def test_true_photo_fallback_is_used_only_at_missing_overlay_pixels():
    tr=Affine(100,0,-2000,0,-100,2000)
    base=m.PhotoRaster(np.full((40,40),50),np.full((40,40),255),tr,m.STEREO)
    high_alpha=np.full((40,40),255);high_alpha[:20]=0
    high=m.PhotoRaster(np.full((40,40),200),high_alpha,tr,m.STEREO)
    image,mask,fractions=m.resample_enu(site(-90,0),1600,16,[base,high])
    assert mask.all()
    assert image[0,8]==50 and image[-1,8]==200
    assert fractions[0]==1 and 0<fractions[1]<1


def test_wms_cache_hash_bounds_and_lunar_projection_are_verified(tmp_path,monkeypatch):
    calls=[]
    class Response:
        def raise_for_status(self):pass
    def get(url,params,headers,timeout):
        calls.append(params)
        w=int(params['WIDTH']);b=list(map(float,params['BBOX'].split(',')))
        tr=Affine((b[2]-b[0])/w,0,b[0],0,-(b[3]-b[1])/w,b[3])
        with MemoryFile() as f:
            with f.open(driver='GTiff',width=w,height=w,count=2,dtype='uint8',crs=m.STEREO,transform=tr) as target:
                target.write(np.full((w,w),99,dtype=np.uint8),1)
                target.write(np.full((w,w),255,dtype=np.uint8),2)
            out=Response();out.content=f.read();return out
    monkeypatch.setattr(m.requests,'get',get)
    first,meta=m.fetch_photo(site(),10000,m.NAC,tmp_path,pixels=32)
    second,again=m.fetch_photo(site(),10000,m.NAC,tmp_path,pixels=32)
    assert len(calls)==1 and meta['rawSha256']==again['rawSha256']
    assert len(meta['querySha256'])==64 and len(meta['transform'])==6
    assert first.pixels.shape==second.pixels.shape==(32,32)
