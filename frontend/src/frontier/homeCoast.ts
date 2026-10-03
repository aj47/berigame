import { DataTexture, LinearFilter, RGBAFormat } from 'three';
import { terrainField } from '@sim';
import { meadowField } from '../../../shared/sim/frontier/regions';
import { MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
/** Same coastal shading along both districts, including the walking seam. */
export const homeCoastTexture = (() => {
  const width=384,height=256,data=new Uint8Array(width*height*4);
  for(let z=0;z<height;z++)for(let x=0;x<width;x++) {
    const tx=(x+.5)/2-.5,tz=(z+.5)/2-.5+MEADOW_OFFSET.z;
    const field=tx<63.5?terrainField(tx,tz):meadowField(tx-MEADOW_OFFSET.x,tz-MEADOW_OFFSET.z);
    const i=(z*width+x)*4,value=Math.round(Math.max(0,Math.min(1,(8-field)/32))*255);
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const t=new DataTexture(data,width,height,RGBAFormat);t.minFilter=LinearFilter;t.magFilter=LinearFilter;t.needsUpdate=true;return t;
})();
