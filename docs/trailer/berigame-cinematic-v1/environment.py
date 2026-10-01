"""Original, deterministic Bramblewild cinematic scenery for Blender 5.x.

The caller owns the scene, actors, camera, lighting and render settings.  This
module creates only scenery; no scene reset, imports, handlers or render calls.
Z is up.  Looking north means looking along +Y.  All scenery uses mesh batches
so this little forest remains practical on a 16 GB machine.
"""
import math
import random
import bpy
from mathutils import Vector

PI = math.pi


def linear_color(value):
    """Hex sRGB -> Blender linear RGBA."""
    value = value.lstrip('#')
    values = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1,)


def material(name, color, roughness=.7, metallic=0, emission=0):
    mat = bpy.data.materials.new('Bramblewild / ' + name)
    mat.diffuse_color = linear_color(color)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = linear_color(color)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    if emission:
        p.inputs['Emission Color'].default_value = linear_color(color)
        p.inputs['Emission Strength'].default_value = emission
    return mat


class Batch:
    def __init__(self, name, mats, collection):
        self.name, self.mats, self.collection = name, mats, collection
        self.verts, self.faces, self.indices, self.smooth = [], [], [], []

    def add(self, verts, faces, mat=0, smooth=False):
        start = len(self.verts)
        self.verts.extend(verts)
        self.faces.extend(tuple(start + n for n in face) for face in faces)
        self.indices.extend([mat] * len(faces))
        self.smooth.extend([smooth] * len(faces))

    def box(self, at, size, mat=0, rotation=0):
        c, s = math.cos(rotation), math.sin(rotation)
        verts = []
        for x, y, z in [(-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
                        (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1)]:
            x, y, z = x * size[0] / 2, y * size[1] / 2, z * size[2] / 2
            verts.append((at[0] + x*c-y*s, at[1] + x*s+y*c, at[2] + z))
        self.add(verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], mat)

    def beam(self, a, b, radius, mat=0, end_radius=None, sides=10):
        a, b = Vector(a), Vector(b)
        axis = (b-a).normalized()
        ref = Vector((0,0,1)) if abs(axis.z) < .9 else Vector((0,1,0))
        u = axis.cross(ref).normalized(); v = axis.cross(u).normalized()
        verts = []
        for center, r in ((a,radius),(b,radius if end_radius is None else end_radius)):
            for i in range(sides):
                q = center + (u*math.cos(i*2*PI/sides)+v*math.sin(i*2*PI/sides))*r
                verts.append(tuple(q))
        faces = [tuple(reversed(range(sides))), tuple(range(sides,sides*2))]
        faces.extend((i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides))
        self.add(verts, faces, mat, True)

    def orb(self, at, size, mat=0, segments=12, rings=7, phase=0):
        verts = [(at[0], at[1], at[2]+size[2])]
        for j in range(1,rings):
            t=j*PI/rings
            for i in range(segments):
                p=i*2*PI/segments+phase
                verts.append((at[0]+size[0]*math.sin(t)*math.cos(p),at[1]+size[1]*math.sin(t)*math.sin(p),at[2]+size[2]*math.cos(t)))
        verts.append((at[0],at[1],at[2]-size[2]))
        last=len(verts)-1
        faces=[(0,1+i,1+(i+1)%segments) for i in range(segments)]
        for j in range(rings-2):
            for i in range(segments):
                a=1+j*segments+i; b=1+j*segments+(i+1)%segments
                faces.append((a,b,b+segments,a+segments))
        start=1+(rings-2)*segments
        faces.extend((last,start+(i+1)%segments,start+i) for i in range(segments))
        self.add(verts,faces,mat,True)

    def finish(self, bevel=0):
        if not self.verts:
            return None
        mesh=bpy.data.meshes.new(self.name+' mesh')
        mesh.from_pydata(self.verts,[],self.faces); mesh.update()
        for mat in self.mats: mesh.materials.append(mat)
        for p,mi,sm in zip(mesh.polygons,self.indices,self.smooth): p.material_index=mi; p.use_smooth=sm
        obj=bpy.data.objects.new(self.name,mesh); self.collection.objects.link(obj)
        if bevel:
            mod=obj.modifiers.new('Crafted softened edges','BEVEL'); mod.width=bevel; mod.segments=2
            mod.limit_method='ANGLE'
        return obj


def brook_y(x):
    return 7 + .85*math.sin(x*.24) + .2*math.sin(x*.61)


def island_radius(x,y):
    return math.sqrt((x/22)**2+((y-4)/20)**2)


def ground_height(x,y):
    r=island_radius(x,y)
    hill=(.28*math.sin(x*.25)*math.sin(y*.22)+.15*math.cos(x*.35+y*.18))
    # Keep all actor stages, the feast and the main trail deliberately flat.
    clear=min(1,max(0,(abs(x)-4.8)/3.2))
    if (x+7)**2+y*y<14 or (x-5)**2+(y-4)**2<11: clear=0
    z=hill*clear
    if r>.83: z=min(z,-.82*((r-.83)/.17)**1.2)
    d=abs(y-brook_y(x))
    if d<1.75: z=min(z,-.62*(1-min(1,(d/1.75)**4)))
    return z


def water_material(name, ocean=False):
    m=material(name,'2DCCCB' if not ocean else '158AA9',.2,.16)
    nt=m.node_tree; p=nt.nodes.get('Principled BSDF')
    p.inputs['IOR'].default_value=1.333
    p.inputs['Coat Weight'].default_value=.35
    p.inputs['Coat Roughness'].default_value=.18
    tex=nt.nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=.58 if ocean else 1.2
    tex.inputs['Detail'].default_value=2;tex.inputs['Roughness'].default_value=.6
    coord=nt.nodes.new('ShaderNodeTexCoord');nt.links.new(coord.outputs['Generated'],tex.inputs['Vector'])
    mapping=nt.nodes.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(85,85,15) if ocean else (14,4,2)
    nt.links.new(coord.outputs['Generated'],mapping.inputs[0]);nt.links.new(mapping.outputs[0],tex.inputs['Vector'])
    ramp=nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[0].color=linear_color('067594' if ocean else '119D9B')
    ramp.color_ramp.elements[1].position=.85;ramp.color_ramp.elements[1].color=linear_color('39B8C7' if ocean else '64D9C9')
    nt.links.new(tex.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],p.inputs['Base Color'])
    bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.14;bump.inputs['Distance'].default_value=.12
    nt.links.new(tex.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs[0],p.inputs['Normal'])
    return m


def build_environment():
    rng=random.Random(47291)
    collection=bpy.data.collections.new('BRAMBLEWILD — original cinematic set')
    bpy.context.scene.collection.children.link(collection)
    green=[material('leaf '+str(i),c,.8) for i,c in enumerate(['408C61','579D62','73AE68','91BC76','326A4D','B4CB80'])]
    wood=[material('timber '+str(i),c) for i,c in enumerate(['815338','AD754B','CB9564','E4BD85','534333'])]
    stone=[material('stone '+str(i),c,.85) for i,c in enumerate(['829483','A0AA94','6D827C','C6C0A2','516763'])]
    cream=material('warm limewash','F4E4BC'); roof=material('weathered teal roof','43776B'); roof_edge=material('roof edge','34554B')
    glow=material('amber window glow','FFD588',.38,0,2)
    petals=[material('flower '+str(i),c) for i,c in enumerate(['FFF1B1','ECC1C7','F4D772','ACA7E2','FFF5DA'])]
    berry_mat=[material('berry purple','675DC8',.35),material('berry red','D56D86',.38),material('leaf tips','B8C874')]
    ground_mat=material('meadow vertex colors','84AA6B',.92)
    nt=ground_mat.node_tree;vc=nt.nodes.new('ShaderNodeVertexColor');vc.layer_name='Meadow'
    nt.links.new(vc.outputs['Color'],nt.nodes.get('Principled BSDF').inputs['Base Color'])
    dirt=linear_color('CBB68D'); meadow=linear_color('83A868'); meadow2=linear_color('96B276'); sand=linear_color('EDD7AC')
    # A continuous triangular terrain, with a carved brook and a sandy skirt.
    verts=[];faces=[];colors=[];steps=156;radial=46
    for j in range(radial+1):
        rr=.0001 if j==0 else j/radial
        for i in range(steps):
            ang=i*2*PI/steps
            wobble=1+.023*math.sin(ang*5)+.014*math.sin(ang*9+.3)
            x=22*rr*wobble*math.cos(ang);y=4+20*rr*wobble*math.sin(ang)
            z=ground_height(x,y);verts.append((x,y,z))
            pathx=.28*math.sin(y*.31)
            main=abs(x-pathx)
            branch=abs(y+.10*x) if -9<x<0 else 20
            path=min(main,branch)
            f=max(0,min(1,(path-1.22)/.65))
            n=(math.sin(x*.6+y*.33)+1)*.5
            grass=tuple(meadow[k]*(1-n)+meadow2[k]*n for k in range(4))
            c=tuple(dirt[k]*(1-f)+grass[k]*f for k in range(4))
            beach=max(0,min(1,(rr-.87)/.085))
            c=tuple(c[k]*(1-beach)+sand[k]*beach for k in range(4))
            bank=max(0,1-abs(abs(y-brook_y(x))-1.6)/.37)
            colors.append(tuple(c[k]*(1-bank*.45)+sand[k]*bank*.45 for k in range(4)))
    for j in range(radial):
        for i in range(steps):
            a=j*steps+i;b=j*steps+(i+1)%steps;c=(j+1)*steps+(i+1)%steps;d=(j+1)*steps+i
            faces.extend([(a,b,c),(a,c,d)])
    mesh=bpy.data.meshes.new('Rolling meadow and carved brook');mesh.from_pydata(verts,[],faces);mesh.update()
    mesh.materials.append(ground_mat)
    ca=mesh.color_attributes.new(name='Meadow',type='FLOAT_COLOR',domain='POINT')
    for d,c in zip(ca.data,colors):d.color=c
    for p in mesh.polygons:p.use_smooth=True
    land=bpy.data.objects.new('Bramblewild meadow',mesh);collection.objects.link(land)
    cliffs=Batch('Soft island sandstone cliffs',stone,collection)
    for i in range(steps):
        a=verts[radial*steps+i];b=verts[radial*steps+(i+1)%steps]
        cliffs.add([a,b,(b[0]*.96,4+(b[1]-4)*.96,-2.8),(a[0]*.96,4+(a[1]-4)*.96,-2.8)],[(0,1,2,3)],3)
    cliffs.finish()
    ocean=Batch('Turquoise sea',[water_material('open sea',True)],collection)
    ocean.add([(-160,-160,-1.42),(160,-160,-1.42),(160,160,-1.42),(-160,160,-1.42)],[(0,1,2,3)]); ocean_obj=ocean.finish()
    brook=Batch('The winding brook',[water_material('shallow running brook')],collection)
    for i in range(150):
        x=-22+i*44/150;xx=-22+(i+1)*44/150
        z=-.28-max(0,abs(x)-17)*.25;zz=-.28-max(0,abs(xx)-17)*.25
        brook.add([(x,brook_y(x)-1.28,z),(xx,brook_y(xx)-1.28,zz),(xx,brook_y(xx)+1.28,zz),(x,brook_y(x)+1.28,z)],[(0,1,2,3)])
    brook_obj=brook.finish()
    # Small pale ripples give the brook legibility without noisy highlights.
    foam_mat=material('soft foam','DAF8E3',.35)
    foam=Batch('Stream glints',[foam_mat],collection)
    for i in range(70):
        x=rng.uniform(-17,17);y=brook_y(x)+rng.uniform(-1.05,1.05)
        length=rng.uniform(.12,.55)
        foam.add([(x,y,-.265),(x+length,y+.02,-.265),(x+length*.87,y+.046,-.265),(x+.02,y+.028,-.265)],[(0,1,2,3)])
    foam.finish()
    # Handmade arched planks, posts, rope rails and tiny brass fasteners.
    bridge=Batch('Millbridge / hand cut timber',wood,collection)
    rope=Batch('Millbridge / woven rope',[material('hemp rope','DBC596')],collection)
    fittings=Batch('Millbridge / warm iron',[material('warm iron','756E4C',.38,.55)],collection)
    def bridge_z(y):return .13+.23*math.sin(max(0,min(1,(y-4.55)/4.9))*PI)
    for i in range(22):
        y=4.6+i*4.8/21;z=bridge_z(y)
        bridge.box((rng.uniform(-.02,.02),y,z),(2.65+rng.uniform(-.08,.1),.207,.135),i%3)
        for x in (-1.08,1.08):fittings.orb((x,y,z+.071),(.027,.027,.014),0,6,3)
    for x in (-1.17,1.17):
        for y in (4.55,5.75,7,8.25,9.5):
            z=bridge_z(y)
            bridge.beam((x,y,z-.2),(x,y,z+1.17),.087,1,.068)
            bridge.orb((x,y,z+1.2),(.105,.105,.075),3,8,5)
        for y0,y1 in zip((4.55,5.75,7,8.25),(5.75,7,8.25,9.5)):
            for level in (.61,1.06):
                points=[]
                for j in range(13):
                    t=j/12;y=y0+(y1-y0)*t
                    points.append((x,y,bridge_z(y)+level-.12*math.sin(t*PI)))
                for a,b in zip(points,points[1:]):rope.beam(a,b,.025,0,sides=6)
        bridge.beam((x,4.48,-.1),(x,9.55,-.1),.14,4,sides=8)
    bridge_obj=bridge.finish(.025);rope.finish();fittings.finish()
    # Cottages include windows recessed behind framing, overlapping shingles,
    # ridge caps, flower boxes, stone steps and real roof silhouettes.
    houses=Batch('Old Brook Mill and cottage walls',[cream]+wood+stone+[glow,roof,roof_edge],collection)
    # indices: cream=0 wood=1..5 stone=6..10 glow=11 roof=12 edge=13
    gardens=Batch('Cottage window gardens',green+petals,collection)
    def cottage(x,y,w,d,h):
        z=.03
        houses.box((x,y,z+h/2),(w,d,h),0)
        houses.box((x,y,.1),(w+.18,d+.18,.23),7)
        roofrise=w*.43; ridge=h+roofrise
        # Triangular gable ends.
        houses.add([(x-w/2,y-d/2,h),(x+w/2,y-d/2,h),(x,y-d/2,ridge),
                    (x-w/2,y+d/2,h),(x+w/2,y+d/2,h),(x,y+d/2,ridge)],[(0,1,2),(5,4,3)],0)
        for side in (-1,1):
            for row in range(7):
                t0=row/7;t1=min(1,(row+1.24)/7)
                xa=x+side*(w/2+.25)*t0;xb=x+side*(w/2+.25)*t1
                za=ridge+.05-roofrise*t0;zb=ridge+.05-roofrise*t1
                for col in range(11):
                    ya=y-d/2-.28+col*(d+.56)/11;yb=ya+(d+.56)/11*.98
                    houses.add([(xa,ya,za),(xb,ya,zb),(xb,yb,zb),(xa,yb,za)],[(0,1,2,3)],12 if (row+col)%5 else 13)
            houses.beam((x+side*(w/2+.24),y-d/2-.32,h-.02),(x+side*(w/2+.24),y+d/2+.32,h-.02),.08,13)
        houses.beam((x,y-d/2-.36,ridge+.045),(x,y+d/2+.36,ridge+.045),.095,13)
        for yy in (-1,1):
            for xx in (-1,1):
                houses.beam((x+xx*w/2,y+yy*d/2,0),(x+xx*w/2,y+yy*d/2,h),.065,2)
            houses.beam((x-w/2,y+yy*(d/2+.015),h),(x+w/2,y+yy*(d/2+.015),h),.065,2)
        front=y-d/2-.035
        houses.box((x,front,.79),(.77,.08,1.5),1)
        for k in range(5):houses.box((x-.31+k*.155,front-.052,.79),(.025,.028,1.39),3)
        houses.orb((x+.23,front-.105,.78),(.05,.04,.05),3,8,5)
        for k in range(2):houses.box((x,front-.27-k*.21,.09-k*.025),(1.01+k*.16,.45,.18),7)
        for dx in (-w*.32,w*.32):
            houses.box((x+dx,front,1.65),(.59,.075,.75),11)
            for sx in (-1,1):houses.box((x+dx+sx*.335,front-.05,1.65),(.095,.12,.87),2)
            houses.box((x+dx,front-.065,1.65),(.048,.07,.81),2)
            houses.box((x+dx,front-.065,1.65),(.65,.07,.06),2)
            houses.box((x+dx,front-.17,1.17),(.84,.36,.22),3)
            for q in range(7):
                xx=x+dx+rng.uniform(-.35,.35);yy=front+rng.uniform(-.31,-.04)
                gardens.orb((xx,yy,1.33),(.15,.14,.11),2,8,5)
                gardens.orb((xx,yy,1.45),(.063,.063,.047),6+q%len(petals),7,4)
        # Small chimney with stone cap.
        houses.box((x+w*.25,y+.24,h+roofrise*.82),(.48,.56,1.07),7)
        houses.box((x+w*.25,y+.24,h+roofrise*.82+.59),(.61,.68,.16),6)
    cottage(5.3,11.2,3.65,3.8,2.65)
    cottage(-9.4,12.5,3.15,3.5,2.4)
    houses.finish(.025);gardens.finish()
    # Wheel is a separate object with its origin on its Y axis for animation.
    wheel=Batch('Old Brook Mill / turning waterwheel',wood,collection)
    wx,wy,wz=5.3,8.99,1.0;wr=1.42
    for yy in (-.29,.29):
        for i in range(40):
            a=i*2*PI/40;b=(i+1)*2*PI/40
            for rad in (wr*.91,wr):
                wheel.beam((rad*math.sin(a),yy,rad*math.cos(a)),(rad*math.sin(b),yy,rad*math.cos(b)),.052,1,sides=6)
        for i in range(10):
            a=i*2*PI/10
            wheel.beam((0,yy,0),(wr*.94*math.sin(a),yy,wr*.94*math.cos(a)),.07,2,sides=6)
    for i in range(20):
        a=i*2*PI/20
        v=[(-.15,-.39,-.06),(.15,-.39,-.06),(.15,.39,-.06),(-.15,.39,-.06),
           (-.15,-.39,.06),(.15,-.39,.06),(.15,.39,.06),(-.15,.39,.06)]
        v=[(xx*math.cos(a)+(zz+wr)*math.sin(a),yy,-xx*math.sin(a)+(zz+wr)*math.cos(a)) for xx,yy,zz in v]
        wheel.add(v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],2 if i%3 else 1)
    wheel.beam((0,-.5,0),(0,.58,0),.17,4,sides=12)
    wheel_obj=wheel.finish(.018);wheel_obj.location=(wx,wy,wz)
    # A little lookout on the distant ridge preserves the island's identity.
    beacon=Batch('Northwatch Beacon',[cream,roof,glow]+stone+wood,collection)
    beacon.beam((-.3,19.2,-.15),(-.3,19.2,4.1),.58,0,.43,12)
    beacon.beam((-.3,19.2,4.12),(-.3,19.2,4.21),.71,4,sides=12)
    beacon.beam((-.3,19.2,4.22),(-.3,19.2,5.15),.43,2,sides=12)
    for i in range(8):
        a=i*2*PI/8
        beacon.beam((-.3+.45*math.cos(a),19.2+.45*math.sin(a),4.2),(-.3+.45*math.cos(a),19.2+.45*math.sin(a),5.25),.046,8,sides=6)
    beacon.beam((-.3,19.2,5.25),(-.3,19.2,5.9),.84,1,0,12)
    beacon.finish(.015)
    # A curved, multi-lobed deciduous canopy feels lush at cinematic distances.
    trunks=Batch('Grove / curved trunks and branches',wood,collection)
    foliage=Batch('Grove / soft layered canopy',green,collection)
    fruit=Batch('Grove / berries',berry_mat,collection)
    tree_positions=[(-16,-6),(-14,-2),(-17,3),(-16,8),(-16,12),(-13,16),(-9,18),(-5,20),
                    (4,19),(8,18),(12,17),(15,12),(17,7),(16,2),(15,-4),(12,-8),
                    (-11,6),(-12,1),(-18,-8),(11,6),(12,11),(9,15),(-6,15),(-2,15),
                    (-18,0),(-18,6),(-15,15),(16,10),(16,-1),(12,-11),(-16,-11)]
    for tx,ty in tree_positions:
        x=tx+rng.uniform(-.5,.5);y=ty+rng.uniform(-.5,.5);z=ground_height(x,y)
        h=rng.uniform(4.2,6.5);lean=rng.uniform(-.4,.4);tr=rng.uniform(.23,.36)
        points=[(x,y,z),(x+lean*.25,y+.1,z+h*.24),(x+lean,y-.12,z+h*.52),(x+lean*.8,y,z+h*.79)]
        for i,(a,b) in enumerate(zip(points,points[1:])):trunks.beam(a,b,tr*(1-.2*i),0 if i%2 else 1,tr*(.82-.18*i),10)
        # Buttress roots anchor the silhouette to the ground.
        for i in range(4):
            a=i*PI/2+.4
            trunks.beam((x+math.cos(a)*.61,y+math.sin(a)*.61,z+.04),(x,y,z+.55),.09,0,.18,8)
        for i in range(5):
            a=i*2*PI/5+rng.uniform(-.15,.15);rad=rng.uniform(.8,1.3)
            px=x+lean+rad*math.cos(a);py=y+rad*math.sin(a);pz=z+h*.73+rng.uniform(-.25,.25)
            trunks.beam((x+lean,y,z+h*.5),(px,py,pz),.12,0,.05,8)
            foliage.orb((px,py,pz), (rng.uniform(1.35,1.8),rng.uniform(1.3,1.7),rng.uniform(1.05,1.5)),i%4,14,8,phase=rng.random())
        foliage.orb((x+lean*.7,y,z+h*.96),(1.4,1.35,1.3),2 if rng.random()>.5 else 3,14,8)
    # Three smaller fruit trees nearer the action.
    for x,y in [(-5.7,4.7),(8.3,-.7),(-4.5,11.1)]:
        z=ground_height(x,y);trunks.beam((x,y,z),(x+.1,y,2.1),.16,1,.085,10)
        for i in range(5):
            a=i*2*PI/5;px=x+math.cos(a)*.62;py=y+math.sin(a)*.57
            foliage.orb((px,py,2.2),(.86,.81,.76),i%4,12,7)
            for k in range(3):
                aa=a+(k-1)*.45
                fruit.orb((px+.61*math.cos(aa),py+.64*math.sin(aa),2.08+rng.uniform(-.25,.3)),(.12,.12,.15),k%2,9,6)
        foliage.orb((x,y,2.85),(.83,.8,.63),3,12,7)
    trunks.finish();foliage.finish();fruit.finish()
    # Low forest shrubs occupy the edges while keeping eye-level lanes clear.
    shrubs=Batch('Grove / understory',green,collection)
    rocks=Batch('Brook stones and mossy boulders',stone+green,collection)
    for i in range(88):
        a=rng.uniform(0,2*PI);r=rng.uniform(.65,.92)
        x=21*r*math.cos(a);y=4+18*r*math.sin(a)
        if abs(y-brook_y(x))<2.1 or abs(x)<2.8 or (x+7)**2+y*y<15:continue
        z=ground_height(x,y);size=rng.uniform(.35,.8)
        shrubs.orb((x,y,z+size*.55),(size,size*.86,size*.73),rng.choice([0,1,2,4]),10,6)
    for i in range(54):
        x=rng.uniform(-18,18);y=brook_y(x)+rng.choice([-1,1])*rng.uniform(1.45,1.9)
        if abs(x)<1.7:continue
        z=ground_height(x,y);s=rng.uniform(.12,.42)
        rocks.orb((x,y,z+s*.2),(s,s*.8,s*.55),rng.randrange(4),8,5,rng.random())
    for x,y,s in [(-12,-3,1.1),(11,3,.9),(-11,8,1),(10,11,1.1),(16,-6,1.2),(-15,-8,1),(-7,15,.7)]:
        z=ground_height(x,y);rocks.orb((x,y,z+s*.4),(s,s*.85,s*.6),rng.randrange(3),10,6)
        rocks.orb((x-.08,y,z+s*.83),(s*.79,s*.71,s*.18),7,10,5)
    shrubs.finish();rocks.finish()
    # Scattered grass blades and small flowers: geometry is batched and kept
    # clear of action stages, dirt trail and stream. No particle system cost.
    grass=Batch('Meadow / individual grass silhouettes',green,collection)
    flowers=Batch('Meadow / wildflowers',green+petals,collection)
    def available(x,y):
        if island_radius(x,y)>.88 or abs(y-brook_y(x))<2:return False
        if abs(x)<2.1:return False
        if -9<x<0 and abs(y+.1*x)<1.9:return False
        if (x+7)**2+y*y<7 or (x-5)**2+(y-4)**2<5:return False
        if 3<x<7.6 and 9<y<14:return False
        if -11.5<x<-7.1 and 10<y<15:return False
        return True
    for i in range(740):
        x=rng.uniform(-19,19);y=rng.uniform(-12,21)
        if not available(x,y):continue
        z=ground_height(x,y)+.009
        for j in range(rng.randrange(3,6)):
            a=rng.random()*2*PI;hh=rng.uniform(.1,.3);wide=rng.uniform(.025,.048)
            dx=math.cos(a)*wide;dy=math.sin(a)*wide
            grass.add([(x-dx,y-dy,z),(x+dx,y+dy,z),(x+math.sin(a)*hh*.42,y-math.cos(a)*hh*.42,z+hh)],[(0,1,2)],rng.choice([1,2,3,5]))
    for i in range(260):
        x=rng.uniform(-18,18);y=rng.uniform(-11,20)
        if not available(x,y):continue
        z=ground_height(x,y);h=rng.uniform(.13,.36);col=rng.choice([6,7,8,9,10]);sz=rng.uniform(.04,.07)
        flowers.beam((x,y,z),(x+.018,y,z+h),.009,1,.006,5)
        for j in range(5):
            a=j*2*PI/5
            flowers.orb((x+math.cos(a)*sz*.6,y+math.sin(a)*sz*.6,z+h),(sz*.62,sz*.62,sz*.23),col,6,4)
        flowers.orb((x,y,z+h+.008),(sz*.3,sz*.3,sz*.21),8,6,4)
    grass.finish();flowers.finish()
    # A handful of mushrooms and fallen logs reward closer camera passes.
    small=Batch('Grove / woodland treasures',wood+petals+stone,collection)
    for x,y in [(-9,-4),(10,1),(-12,6),(8,12),(-6,13)]:
        z=ground_height(x,y)
        for i in range(3):
            xx=x+rng.uniform(-.3,.3);yy=y+rng.uniform(-.3,.3);hh=rng.uniform(.11,.21)
            small.beam((xx,yy,z),(xx,yy,z+hh),.027,8,sides=7)
            small.orb((xx,yy,z+hh),(.095,.095,.049),6,9,5)
    small.beam((-11,-4,.19),(-8.8,-4.8,.19),.21,0,.18,12)
    small.beam((9.8,5.3,.2),(11.9,5.8,.2),.22,0,.18,12)
    small.finish()
    # Lantern poles at the feast add a warm destination without occupying its
    # center; the caller can place the actual original feast prop and actors.
    lantern=Batch('Lantern Clearing / festoon poles',wood+[glow,roof_edge],collection)
    for x,y in [(-9.5,2.7),(-4.7,2.7)]:
        lantern.beam((x,y,0),(x,y,2.9),.075,1,.04,8)
    for i in range(30):
        t=i/30;tt=(i+1)/30
        a=(-9.5+4.8*t,2.7,2.83-.35*math.sin(t*PI));b=(-9.5+4.8*tt,2.7,2.83-.35*math.sin(tt*PI))
        lantern.beam(a,b,.012,4,sides=5)
    for i in range(7):
        t=(i+.5)/7;x=-9.5+4.8*t;z=2.83-.35*math.sin(t*PI)
        lantern.beam((x,2.7,z),(x,2.7,z-.16),.012,4,sides=5)
        lantern.orb((x,2.7,z-.25),(.09,.09,.13),5,10,6)
        lantern.beam((x,2.7,z-.12),(x,2.7,z-.15),.09,6,sides=8)
    lantern.finish()
    # Distant soft clouds are geometry, deliberately beyond the complete set.
    clouds=Batch('Distant storybook clouds',[material('cloud cream','F3ECD9',1)],collection)
    for x,y,z,s in [(-35,48,12,5),(-12,55,15,6),(23,48,13,5.2),(43,64,16,7)]:
        for k in range(4):clouds.orb((x+k*s*.53,y+rng.uniform(-1,1),z+rng.uniform(-.3,.5)),(s*.7,s*.45,s*.32),0,12,7)
    clouds.finish()
    return {
        'collection':collection, 'ground':land, 'ocean':ocean_obj,
        'brook':brook_obj, 'bridge':bridge_obj, 'waterwheel':wheel_obj,
        'wheel':wheel_obj, 'bridge_deck_z':.44,
        'waterwheel_axis':'Y', 'main_stage':(0,0,0),
        'feast_stage':(-7,0,0), 'giant_reveal':(5,4,0),
        'bridge_center':(0,7,.36), 'mill':(5.3,11.2,0),
        'camp':(0,-2,0), 'beacon':(-.3,19.2,0),
        'brook_center':(0,7,-.28), 'camera_south':(0,-16,6),
    }
