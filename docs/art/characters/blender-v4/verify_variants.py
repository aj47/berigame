import struct,json,hashlib,sys
# Animation is compared within a tolerance: rebuilding on another OS changes float noise.
TOL=1e-4
JOINTS=int(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--joints=')),'27'))
from pathlib import Path
root=Path(__file__).resolve().parent
components={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(p):
 b=p.read_bytes();jlen=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+jlen]);off=20+jlen;size=struct.unpack_from('<I',b,off)[0];return j,b[off+8:off+8+size]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];fmt,n=components[a['componentType']];count=widths[a['type']];stride=v.get('byteStride',n*count);start=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+fmt*count,b,start+k*stride) for k in range(a['count'])]
results={};baseline=None
for id in ['tousled','cropped','topknot']:
 p=root/id/f'starter-adventurer-v4-{id}.glb';j,b=load(p)
 signature=[];values=[]
 for clip in j['animations']:
  samplers=[(accessor(j,b,s['input']),accessor(j,b,s['output']),s.get('interpolation')) for s in clip['samplers']]
  signature.append((clip['name'],clip['channels'],[(len(i),len(o),n) for i,o,n in samplers]))
  values.extend(v for i,o,n in samplers for row in i+o for v in row)
 animhash=hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()
 primitive=j['meshes'][0]['primitives'][0];at=primitive['attributes'];pos=accessor(j,b,at['POSITION']);uv=accessor(j,b,at['TEXCOORD_0']);joint=accessor(j,b,at['JOINTS_0']);weight=accessor(j,b,at['WEIGHTS_0']);normal=accessor(j,b,at['NORMAL'])
 body=[]
 for k,tex in enumerate(uv):
  col=int(tex[0]*8);row=int((1-tex[1])*8);idx=row*8+col
  if idx not in [16,17,18]:body.append((pos[k],normal[k],tex,joint[k],weight[k]))
 bodyhash=hashlib.sha256(json.dumps(sorted(body)).encode()).hexdigest()
 record={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'animation_data_hash':animhash,'non_hair_vertex_data_hash':bodyhash,'non_hair_vertex_count':len(body),'triangles':len(accessor(j,b,primitive['indices']))//3,'materials':len(j['materials']),'skin_joints':len(j['skins'][0]['joints']),'animation_names':[x['name'] for x in j['animations']]}
 if baseline:
  assert animhash==baseline['animation_data_hash'],id+' animation layout drift'
  assert len(values)==len(base_values) and max((abs(x-y) for x,y in zip(values,base_values)),default=0)<=TOL,id+' animation drift'
  assert bodyhash==baseline['non_hair_vertex_data_hash'],id+' body drift'
 else:baseline=record;base_values=values
 assert record['triangles']<=2500 and record['materials']==1 and record['skin_joints']==JOINTS
 results[id]=record
(root/'variant-verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({k:{a:v[a] for a in ['triangles','materials','skin_joints','sha256']} for k,v in results.items()},indent=2))
print('All body vertex/normal/UV/skin data and animation data identical (animation within 1e-4) outside hair palette cells.')
