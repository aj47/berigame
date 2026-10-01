"""Original BeriGame adventure assets. Run only in an isolated background Blender.

Blender --background --factory-startup --python docs/art/adventure-v1/build_assets.py
Reuses the repository's original adventurer rig for the two islanders. All props
and creatures are authored here; no downloaded art or external licenses.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi

assert bpy.app.background, 'Run in an isolated background Blender process.'
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'frontend/public/models/adventure'
OUT.mkdir(parents=True,exist_ok=True)
random.seed(32)
WOOD='92643F'; DARK='513C2D'; CREAM='F4DCAC'; GREEN='688A43'; LEAF='96B85D'; BERRY='B94C72'; GOLD='E6B84D'
def rgb(h):
    v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return [x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]+[1]
def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o,do_unlink=True)
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    scene=bpy.context.scene;scene.frame_set(1);scene.render.fps=30
    global MAT
    MAT=bpy.data.materials.new('Adventure vertex palette');MAT.use_nodes=True
    bs=next(n for n in MAT.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Roughness'].default_value=.83
    vc=MAT.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color'
    MAT.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
def paint(o,color):
    o.data.materials.clear();o.data.materials.append(MAT)
    a=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    c=rgb(color)
    for d in a.data:d.color=c
    return o
def finish(o,name,at,scale,color):
    o.name=name;o.location=at;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return paint(o,color)
def orb(at,scale,color,name='rounded',detail=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=detail,radius=1)
    return finish(bpy.context.object,name,at,scale,color)
def box(at,scale,color,name='timber',bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=finish(bpy.context.object,name,at,scale,color)
    if bevel:
        m=o.modifiers.new('soft edges','BEVEL');m.width=bevel;m.segments=1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o
def cylinder(at,radius,depth,color,name='round wood',r2=None,vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=depth)
    return finish(bpy.context.object,name,at,(1,1,1),color)
def beam(a,b,r,color,name='branch',r2=None):
    d=Vector(b)-Vector(a);o=cylinder((Vector(a)+Vector(b))/2,r,d.length,color,name,r2,8)
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(d.normalized())
    return o
def torus(at,major,minor,color,name='rim',rotation=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=16,minor_segments=6)
    o=finish(bpy.context.object,name,at,(1,1,1),color)
    if rotation:o.rotation_euler=rotation
    return o
def leaf(at,length=.45,width=.18,color=LEAF,angle=0):
    # A folded leaf with a raised midrib and a tapered tip.
    m=bpy.data.meshes.new('folded leaf');m.from_pydata([(0,0,0),(-width,length*.48,.03),(0,length,0),(width,length*.48,.03),(0,length*.48,.09)],[],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(4,1,0),(4,2,1),(4,3,2),(4,0,3)]);m.update()
    o=bpy.data.objects.new('Leaf',m);bpy.context.collection.objects.link(o);o.location=at;o.rotation_euler.z=angle;return paint(o,color)
def merge(parts,name,pivot=(0,0,0)):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    # Bake to a stable local origin for animation and attachment.
    transform=Matrix.Translation(-Vector(pivot))@o.matrix_world
    o.data.transform(transform);o.matrix_world=Matrix.Translation(Vector(pivot));return o
def since(before):return [o for o in bpy.context.scene.objects if o not in before and o.type=='MESH']
def group_mesh(name,fn,pivot=(0,0,0)):
    before=set(bpy.context.scene.objects);fn();return merge(since(before),name,pivot)
def parent(o,p):
    w=o.matrix_world.copy();o.parent=p;o.matrix_world=w
def empty(name):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o
def export(name):
    bpy.context.scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    objs=[o for o in bpy.context.scene.objects if o.type in ('MESH','ARMATURE','EMPTY')]
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/(name+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=False,export_skins=True,export_materials='EXPORT',export_vertex_color='ACTIVE',export_yup=True)
    tris=0
    for o in objs:
        if o.type=='MESH':o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles)
    report[name]={'triangles':tris,'meshes':sum(o.type=='MESH' for o in objs),'bytes':(OUT/(name+'.glb')).stat().st_size}
def skin(o,rig,bone):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.vertex_groups.new(name=bone).add(list(range(len(o.data.vertices))),1,'REPLACE')
    m=o.modifiers.new('Accessory skin','ARMATURE');m.object=rig;o.parent=rig
def basket(at,scale=1):
    x,y,z=at
    cylinder((x,y,z+.24*scale),.29*scale,.46*scale,WOOD,r2=.36*scale)
    for h in [.08,.22,.4]:torus((x,y,z+h*scale),(.29+h*.14)*scale,.022*scale,CREAM)
    for i in range(10):
        a=i*2*pi/10;beam((x+.3*scale*cos(a),y+.3*scale*sin(a),z),(x+.36*scale*cos(a),y+.36*scale*sin(a),z+.47*scale),.015*scale,DARK)
def berry(at=(0,0,.82),r=.82,color=BERRY):
    x,y,z=at;orb(at,(r,r*.92,r),color,'fruit',3)
    for i in range(5):leaf((x,y,z+r*.88),r*.68,r*.20,GREEN,i*2*pi/5)
    beam((x,y,z+r*.85),(x+.10*r,y,z+r*1.3),r*.065,DARK,'stem')
    for j in range(3):
        az=.35+j*.5
        for k in range(9):
            a=k*2*pi/9+(j%2)*.2; rr=r*cos(az);orb((x+rr*cos(a)*1.005,y+rr*sin(a)*.93,z+r*sin(az)),(r*.035,r*.028,r*.055),GOLD,'seed',1)
def npc_human(name):
    reset();src=ROOT/'docs/art/characters/blender-v4/cropped/starter-adventurer-v4-cropped.blend'
    # These original actions were authored at 60 fps.
    bpy.context.scene.render.fps=60
    with bpy.data.libraries.load(str(src),link=False) as (a,b):b.objects=['Beri_Adventurer','StarterAdventurer'];b.actions=['Idle','Walk']
    for o in b.objects:bpy.context.collection.objects.link(o)
    rig=next(o for o in b.objects if o.type=='ARMATURE');body=next(o for o in b.objects if o.type=='MESH')
    rig.animation_data.action=None
    for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
    rig.pose.bones['Prop.R'].scale=(0,0,0)
    for a in b.actions:a.use_fake_user=True
    # Keep the original palette conventions, changing only the NPC's wardrobe.
    for mat in body.data.materials:
        for n in mat.node_tree.nodes:
            if n.type=='TEX_IMAGE' and n.image:
                im=n.image.copy();px=list(im.pixels);colors={0:'657F49',1:'4E6439',2:'83995B',3:'E4C58B',4:'CCAB72',5:'F2DCAA',16:'B6AAA0',17:'D2C7B8',18:'E0D4BD'} if name=='gardener' else {0:'477B73',1:'365E57',2:'71938B',3:'E0B57C',4:'B88851',5:'F0CE93',16:'442E26',17:'6F4830',18:'8A603E'}
                for yy in range(64):
                    for xx in range(64):
                        c=colors.get((yy//8)*8+xx//8)
                        if c:px[(yy*64+xx)*4:(yy*64+xx)*4+3]=[int(c[i:i+2],16)/255 for i in (0,2,4)]
                im.pixels=px;im.pack();n.image=im
    if name=='gardener':
        def hat():
            cylinder((0,0,2.13),.49,.065,CREAM,'straw brim',vertices=16)
            cylinder((0,0,2.25),.28,.23,'DAB575','hat crown',r2=.24)
            cylinder((0,0,2.18),.287,.07,GREEN,'hat band')
            leaf((.27,-.05,2.18),.23,.09,LEAF,-.9)
            orb((.29,-.09,2.23),(.07,.045,.07),BERRY,'hat berry')
        skin(group_mesh('GardenHat',hat),rig,'Head')
        def apron():
            box((0,-.16,1.21),(.39,.07,.38),CREAM,'apron')
            box((0,-.2,1.17),(.25,.035,.14),WOOD,'seed pocket')
            for x in [-.1,0,.1]:orb((x,-.226,1.21),(.025,.018,.027),GOLD,detail=1)
        skin(group_mesh('GardenApron',apron),rig,'Spine')
        skin(group_mesh('GardenBeard',lambda:orb((0,-.21,1.67),(.17,.075,.13),'DED2B9','beard')),rig,'Head')
    else:
        def pack():
            box((0,.29,1.3),(.57,.34,.68),WOOD,'porter pack',.075)
            for x in [-.22,.22]:box((x,.475,1.3),(.055,.035,.7),CREAM,'straps')
            bed=cylinder((0,.30,1.70),.13,.73,'A6B588','rolled blanket');bed.rotation_euler.y=pi/2
            for x in [-.2,.2]:torus((x,.30,1.70),.137,.022,DARK,rotation=(0,pi/2,0))
            box((.35,.28,1.24),(.16,.22,.22),GREEN,'provision pouch')
        skin(group_mesh('MossPack',pack),rig,'Chest')
        skin(group_mesh('MossCap',lambda:orb((0,.025,2.10),(.29,.23,.10),'BC915A','soft cap')),rig,'Head')
        rig.scale=(1.22,1.13,1.02)
    export(name)
def fox():
    reset();root=empty('PipRoot')
    def torso():
        orb((0,.04,.53),(.25,.47,.27),'BA7441','fox body')
        orb((0,-.25,.57),(.20,.18,.24),CREAM,'cream chest')
        box((0,.16,.76),(.33,.29,.08),'527F68','little satchel',.025)
        beam((-.23,.04,.46),(-.24,.04,.72),.025,DARK)
    body=group_mesh('PipBody',torso,(0,0,.50));parent(body,root)
    def face():
        orb((0,-.43,.88),(.25,.22,.25),'C9894E','fox cheeks')
        orb((0,-.62,.78),(.16,.18,.105),CREAM,'muzzle')
        orb((0,-.765,.79),(.06,.035,.045),'342D2B','nose')
        for s in [-1,1]:
            ear=orb((s*.17,-.40,1.17),(.105,.08,.24),'BA7441','ear',1);ear.rotation_euler.y=s*.15
            inner=orb((s*.17,-.468,1.18),(.055,.025,.14),'E8B4A0','inner ear',1);inner.rotation_euler.y=s*.15
            orb((s*.135,-.616,.94),(.045,.02,.061),'292721','eye')
            orb((s*.129,-.636,.962),(.014,.006,.019),'FFF1D1','eye shine',1)
            beam((s*.08,-.618,1.015),(s*.19,-.583,1.038),.015,DARK,'brow')
        for s in [-1,1]:beam((s*.05,-.737,.735),(s*.115,-.68,.739),.011,DARK,'smile')
    head=group_mesh('PipHead',face,(0,-.30,.73));parent(head,root)
    tail=group_mesh('PipTail',lambda:(orb((0,.52,.57),(.2,.39,.23),'BA7441','bushy tail'),orb((0,.80,.65),(.17,.23,.2),CREAM,'tail tip')),(0,.34,.51));parent(tail,root)
    for s in [-1,1]:
        for j,y in enumerate([-.2,.32]):
            def leg():
                orb((s*.17,y,.28),(.09,.105,.21),'BA7441')
                orb((s*.17,y-.025,.105),(.10,.14,.10),DARK,'paw')
            o=group_mesh(f'PipLeg{"L" if s==1 else "R"}{j}',leg,(s*.17,y,.46));parent(o,root)
    export('pip')
def giant():
    reset();root=empty('GiantRoot')
    def body():
        orb((0,.08,2.25),(1.05,.69,1.18),'838D9C','round stone body')
        orb((0,-.52,2.03),(.67,.25,.74),'B5AEA2','belly')
        for s in [-1,1]:
            orb((s*.78,.03,3.0),(.47,.49,.24),GREEN,'moss shoulders')
            for j in range(3):leaf((s*.72,j*.18-.2,3.14),.43,.13,LEAF,j*1.7)
    parent(group_mesh('GiantBody',body,(0,0,1.24)),root)
    def face():
        orb((0,-.06,3.57),(.70,.58,.62),'919AA7','stone head')
        orb((0,-.59,3.50),(.20,.18,.16),'B5AEA2','nose')
        for s in [-1,1]:
            orb((s*.72,.02,3.53),(.21,.15,.22),'838D9C','ear')
            orb((s*.28,-.58,3.72),(.105,.037,.105),'273730','eye')
            orb((s*.27,-.617,3.755),(.036,.009,.038),'F4E9C5','catchlight',1)
            brow=orb((s*.29,-.59,3.9),(.25,.08,.087),GREEN,'moss brow');brow.rotation_euler.y=-s*.14
            beam((s*.04,-.61,3.24),(s*.31,-.54,3.30),.03,DARK,'smile')
        for j in range(8):
            a=j*2*pi/8;leaf((.46*cos(a),.32*sin(a),4.03),.40,.19,LEAF,a)
        for x,y,z in [(-.4,-.13,4.13),(-.18,-.10,4.21),(.31,.09,4.10)]:orb((x,y,z),(.13,.12,.13),BERRY,'berry crown')
    parent(group_mesh('GiantHead',face,(0,0,3.22)),root)
    for s in [-1,1]:
        def arm():
            orb((s*1.16,0,2.39),(.36,.39,.75),'838D9C','arm')
            orb((s*1.18,-.02,1.63),(.40,.39,.41),'919AA7','hand')
            for j in range(3):orb((s*(.94+.21*j),-.22,1.46),(.12,.19,.22),'919AA7','fingers')
            orb((s*.85,-.28,1.73),(.14,.20,.23),'919AA7','thumb')
        parent(group_mesh('GiantArm'+('L' if s==1 else 'R'),arm,(s*.91,0,2.95)),root)
        def leg():
            orb((s*.47,.08,.89),(.37,.40,.63),'707C8A','leg')
            orb((s*.47,-.14,.26),(.43,.57,.27),'838D9C','foot')
            for i in range(3):orb((s*.47+(i-1)*.21,-.59,.19),(.13,.17,.15),'B5AEA2','toes')
        parent(group_mesh('GiantLeg'+('L' if s==1 else 'R'),leg,(s*.47,0,1.29)),root)
    export('berry-giant')
def crate(at,size=.6):
    x,y,z=at
    for s in [-1,1]:
        for j in range(3):box((x+s*size/2,y,z+.12+j*.12),(size*.08,size,.09),WOOD)
        for j in range(3):box((x,y+s*size/2,z+.12+j*.12),(size,size*.08,.09),'AF8051')
    box((x,y,z+.07),(size,size,.10),DARK)
def cart():
    reset()
    def make():
        box((0,0,.59),(1,.94,.12),WOOD)
        for s in [-1,1]:
            for j in range(3):box((s*.51,0,.72+j*.12),(.06,1.03,.085),'B88750')
            for j in range(3):box((0,s*.5,.72+j*.12),(1,.06,.085),WOOD)
            torus((s*.65,0,.40),.30,.067,DARK,rotation=(0,pi/2,0))
            for j in range(6):
                a=j*pi/3;beam((s*.65,0,.4),(s*.65,.29*cos(a),.4+.29*sin(a)),.025,CREAM)
            beam((s*.40,-.35,.62),(s*.34,-1.3,.8),.043,WOOD)
        beam((-.75,0,.4),(.75,0,.4),.05,DARK)
    group_mesh('Handcart',make);export('handcart')
def market():
    reset()
    def make():
        for s in [-1,1]:
            for y in [-.45,.55]:beam((s*1.18,y,0),(s*1.18,y,2.15),.07,DARK,'stall post')
        for j in range(8):box((j*.30-1.05,0,.85),(.285,1.1,.10),WOOD,'counter plank')
        for j in range(7):
            x=j*.36-1.08
            m=bpy.data.meshes.new('awning panel');m.from_pydata([(x-.18,-.8,1.95),(x+.18,-.8,1.95),(x+.18,.15,2.3),(x-.18,.15,2.3),(x-.18,.78,2.0),(x+.18,.78,2.0)],[],[(0,1,2,3),(3,2,5,4),(3,2,1,0),(4,5,2,3)]);m.update();o=bpy.data.objects.new('striped awning',m);bpy.context.collection.objects.link(o);paint(o,BERRY if j%2==0 else CREAM)
            box((x,-.8,1.91),(.36,.035,.16),BERRY if j%2==0 else CREAM,'valance')
        for x,col in [(-.75,'7467AB'),(0,BERRY),(.75,GREEN)]:
            crate((x,0,.88),.54)
            for i in range(6):orb((x+(i%3-1)*.15,(i//3-.5)*.18,1.23),(.115,.1,.11),col,'market berry')
        board=box((0,-.57,.47),(.84,.07,.34),CREAM,'berry sign')
        orb((0,-.62,.48),(.11,.028,.11),BERRY,'sign fruit');leaf((0,-.635,.56),.12,.06,GREEN,.6)
        basket((1.43,.16,0),.9)
    group_mesh('BerryMarket',make);export('market')
def feast():
    reset()
    def make():
        # Serving space stays in the middle; stools and platters ring the edge.
        cylinder((0,0,.12),1.48,.22,WOOD,'stump platter',vertices=16)
        cylinder((0,0,.24),1.43,.04,'CCAA70',vertices=16)
        for r in [.45,.9,1.22]:torus((0,0,.267),r,.012,'B18956')
        for i in range(6):
            a=i*2*pi/6;x,y=1.20*cos(a),1.20*sin(a)
            leaf((x,y,.28),.45,.2,GREEN,a)
            cylinder((x*1.5,y*1.5,.18),.23,.35,DARK,'stool')
        for s in [-1,1]:
            beam((s*1.9,.7,0),(s*1.9,.7,1.2),.08,DARK,'feast post')
            orb((s*1.9,.7,1.2),(.22,.22,.25),GOLD,'lantern')
    group_mesh('FeastClearing',make);export('feast')
def workshop():
    reset()
    def make():
        for x in [-.9,.9]:
            for y in [-.4,.4]:box((x,y,.47),(.12,.12,.94),DARK,'bench leg')
        for j in range(5):box((0,j*.22-.44,1.0),(2.15,.21,.14),WOOD,'worktop')
        box((0,.42,1.48),(2.12,.12,.84),'BD9564','tool rack')
        for x in [-.8,-.4,0,.4,.8]:
            beam((x,.33,1.3),(x+.10,.33,1.72),.03,DARK,'tool handle')
            box((x+.10,.33,1.73),(.17,.08,.09),'868C91','tool head')
        box((.36,-.10,1.09),(.61,.49,.025),'D8DBC6','blueprint')
        for y in [-.22,-.09,.03]:box((.36,y,1.109),(.40,.017,.004),'698781','plan ink',0)
        orb((-.55,-.16,1.25),(.25,.22,.20),'4F415F','obsidian',1)
        basket((1.4,.2,0),.8)
        for i in range(4):beam((-1.55,-.1+i*.13,.16),(-1.1,.2+i*.13,.16),.075,WOOD,'spare wood')
    group_mesh('CampWorkshop',make);export('workshop')
def extras():
    reset();group_mesh('GiantBerry',lambda:berry());export('giant-berry')
    reset()
    def seed():
        orb((0,0,.18),(.40,.36,.18),'74503A','soil mound')
        orb((0,0,.31),(.18,.15,.20),'CEAB65','strange seed')
        beam((0,0,.35),(.02,0,.68),.035,GREEN)
        leaf((0,0,.48),.37,.14,LEAF,-.85);leaf((0,0,.6),.3,.13,GREEN,1.8)
    group_mesh('StrangeSeed',seed);export('strange-seed')
    reset()
    def cover():
        for i in range(10):
            a=i*2*pi/10;leaf((.15*cos(a),.15*sin(a),.11+(i%3)*.05),1.0,.31,GREEN if i%2 else LEAF,a)
    group_mesh('LeafCover',cover);export('leaf-cover')
    reset()
    def bait():
        orb((0,0,.11),(.38,.3,.11),CREAM,'bait cloth')
        for x,y in [(-.15,0),(.13,.06),(0,-.16)]:orb((x,y,.28),(.16,.15,.16),LEAF,'bait berries')
        leaf((0,0,.33),.28,.09,GREEN,.4)
    group_mesh('ScentBait',bait);export('scent-bait')
    reset()
    def site():
        for i in range(5):beam((-.70,-.40+i*.19,.12),(.70,-.4+i*.19,.12),.09,WOOD)
        for s in [-1,1]:beam((s*.8,.5,0),(s*.8,.5,.7),.06,DARK)
        box((0,.50,.62),(1.7,.10,.25),CREAM,'workshop plan')
        orb((0,.43,.62),(.12,.025,.10),'4F415F','obsidian symbol',1)
    group_mesh('WorkshopSupplies',site);export('workshop-site')

report={}
npc_human('gardener');npc_human('moss');fox();giant();cart();market();feast();workshop();extras()
(HERE/'manifest.json').write_text(json.dumps({'generator':'Original BeriGame models; Blender '+bpy.app.version_string,'assets':report},indent=2)+'\n')
print('ADVENTURE_ASSETS',json.dumps(report))
