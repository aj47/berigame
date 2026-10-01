#!/usr/bin/env python3
"""Render BeriGame cinematic typography as transparent, antialiased 1080p PNGs.

Requires Pillow; uses system fonts already present on macOS. All generated files
stay beside this script. Coordinates in the manifest are measured alpha bounds.
"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent
W, H, S = 1920, 1080, 2
SZ = (W*S, H*S)
CREAM = (255, 244, 214, 255)
FOREST = (16, 43, 31, 255)
GOLD = (230, 193, 113, 255)
GEORGIA = '/System/Library/Fonts/Supplemental/Georgia.ttf'
GEORGIA_BOLD = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'
GEORGIA_ITALIC = '/System/Library/Fonts/Supplemental/Georgia Italic.ttf'
AVENIR = '/System/Library/Fonts/Avenir Next.ttc'

def font(size, kind='serif'):
    file, index = {'serif':(GEORGIA,0), 'bold':(GEORGIA_BOLD,0),
                   'italic':(GEORGIA_ITALIC,0), 'sans':(AVENIR,5),
                   'sans_demi':(AVENIR,2)}[kind]
    return ImageFont.truetype(file, round(size*S), index=index)

def blank():
    return Image.new('RGBA', SZ)

def tracked_width(text, f, tracking):
    return sum(f.getlength(c) for c in text) + tracking*S*(len(text)-1)

def mask_text(text, x, y, size, kind='serif', align='left', tracking=0):
    mask = Image.new('L', SZ)
    d = ImageDraw.Draw(mask)
    f = font(size,kind)
    width = tracked_width(text,f,tracking) if tracking else f.getlength(text)
    xp=x*S-(width/2 if align=='center' else width if align=='right' else 0)
    if tracking:
        # Anchor top to cap-height consistently across letterforms.
        yp=y*S-f.getbbox(text)[1]
        for c in text:
            d.text((xp,yp), c, font=f, fill=255)
            xp += f.getlength(c)+tracking*S
    else:
        d.text((xp,y*S-f.getbbox(text)[1]),text,font=f,fill=255)
    return mask

def color_layer(mask, color):
    layer=Image.new('RGBA',SZ,color)
    if color[3] != 255:
        mask=mask.point(lambda v:round(v*color[3]/255))
    layer.putalpha(mask)
    return layer

def offset(mask,dx,dy):
    result=Image.new('L',SZ)
    result.paste(mask,(round(dx*S),round(dy*S)))
    return result

def elegant_text(canvas,text,x,y,size,kind='serif',align='left',tracking=0,logo=False):
    m=mask_text(text,x,y,size,kind,align,tracking)
    halo=offset(m,0,5 if logo else 3).filter(ImageFilter.GaussianBlur((11 if logo else 7)*S))
    canvas.alpha_composite(color_layer(halo,(7,24,15,180 if logo else 215)))
    if logo:
        # A shallow, downward forest extrusion, with a quiet warm lower edge.
        for v in range(9,0,-1):
            edge=offset(m,v*0.38,v)
            canvas.alpha_composite(color_layer(edge,(12+v,42+v,30+v,255)))
        stroke=m.filter(ImageFilter.MaxFilter(7))
        canvas.alpha_composite(color_layer(stroke,(221,187,116,230)))
    else:
        canvas.alpha_composite(color_layer(m.filter(ImageFilter.MaxFilter(3)),(15,36,24,135)))
    # Cream-to-honey vertical fill brings depth without shiny metallic lettering.
    bbox=m.getbbox()
    gradient=Image.new('RGBA',SZ)
    gd=ImageDraw.Draw(gradient)
    if bbox:
        for yp in range(bbox[1],bbox[3]+1):
            a=(yp-bbox[1])/max(1,bbox[3]-bbox[1])
            end=(240,215,167) if logo else (251,236,204)
            color=tuple(round(CREAM[i]*(1-a)+end[i]*a) for i in range(3))+(255,)
            gd.line((bbox[0],yp,bbox[2],yp),fill=color)
    gradient.putalpha(m)
    canvas.alpha_composite(gradient)
    if logo:
        top_edge=ImageChops.subtract(m,offset(m,0,1.35))
        canvas.alpha_composite(color_layer(top_edge,(255,255,235,185)))
    return canvas

def line(canvas,coords,fill,width=1):
    ImageDraw.Draw(canvas).line([tuple(round(v*S) for v in p) for p in coords],fill=fill,width=round(width*S),joint='curve')

def berry_motif(canvas,cx,cy,scale=1):
    """Custom drawing: paired berry orbs and an asymmetric fresh leaf sprig."""
    d=ImageDraw.Draw(canvas)
    def pts(values):return [(round((cx+x*scale)*S),round((cy+y*scale)*S)) for x,y in values]
    # Subtle berry branch and tapered hand-drawn leaves.
    line(canvas,[(cx-4*scale,cy+16*scale),(cx+2*scale,cy-19*scale),(cx+15*scale,cy-37*scale)],(227,196,124,255),2.2*scale)
    d.polygon(pts([(2,-20),(8,-42),(29,-53),(35,-52),(31,-37),(20,-25)]),fill=(167,187,118,255))
    d.polygon(pts([(1,-16),(-9,-32),(-27,-39),(-31,-36),(-20,-21),(-6,-13)]),fill=(228,212,153,255))
    line(canvas,[(cx+5*scale,cy-22*scale),(cx+28*scale,cy-46*scale)],(237,224,164,180),1*scale)
    for bx,by,r,col in [(-10,5,15,(181,96,84,255)),(14,10,17,(213,119,94,255))]:
        x,y=(cx+bx*scale)*S,(cy+by*scale)*S
        rr=r*scale*S
        d.ellipse((round(x-rr),round(y-rr),round(x+rr),round(y+rr)),fill=col)
        d.ellipse((round(x-rr*.49),round(y-rr*.59),round(x-rr*.06),round(y-rr*.21)),fill=(255,220,170,170))

def accent(canvas,x,y):
    line(canvas,[(x,y),(x+45,y)],(228,196,132,220),2)
    d=ImageDraw.Draw(canvas)
    d.ellipse(((x+56)*S,(y-2)*S,(x+60)*S,(y+2)*S),fill=(245,222,174,225))

def caption(lines):
    im=blank()
    x=140
    top=821 if len(lines)==1 else 771
    accent(im,x,top-29)
    for i,text in enumerate(lines):
        elegant_text(im,text,x,top+87*i,70,'serif')
    return im

def end_card():
    im=blank()
    berry_motif(im,960,166,0.9)
    elegant_text(im,'BeriGame',960,223,168,'bold','center',logo=True)
    # Two hairlines balance the sprig without adding a UI container.
    line(im,[(749,152),(894,152)],(223,193,126,140),1)
    line(im,[(1027,152),(1171,152)],(223,193,126,140),1)
    elegant_text(im,'Little island. Giant adventures.',960,409,43,'italic','center')
    elegant_text(im,'beta.berigame.com',960,493,29,'sans_demi','center',tracking=2.2)
    elegant_text(im,'CINEMATIC TRAILER',1780,1000,17,'sans','right',tracking=3)
    return im

def save(im,name):
    out=im.resize((W,H),Image.Resampling.LANCZOS)
    out.save(ROOT/name)
    return out

def main():
    items=[
      ('01_every_big_adventure.png',0.7,3.7,['Every big adventure…']),
      ('02_starts_small.png',5.0,7.8,['…starts small.']),
      ('03_some_friends.png',18.0,21.6,['Some friends','are a little bigger.']),
      ('04_better_together.png',24.0,26.8,['Better, together.']),
      ('05_end_card.png',33.5,40.0,None),
    ]
    records=[]
    overlays=[]
    for name,start,end,lines in items:
        out=save(caption(lines) if lines else end_card(),name)
        overlays.append(out)
        records.append(dict(file=name,start=start,end=end,fade_in=0.55,fade_out=0.5,
                            dimensions=[W,H],alpha_bounds=list(out.getbbox()),
                            text=lines if lines else ['BeriGame','Little island. Giant adventures.','beta.berigame.com','CINEMATIC TRAILER']))
    (ROOT/'manifest.json').write_text(json.dumps(dict(version=1,title='BeriGame cinematic trailer typography',
        design='Warm ivory Georgia, custom berry sprig, shallow forest extrusion, restrained gilded accents.',
        frame_size=[W,H],safe_area=[120,80,1800,1010],end_card_primary_type_bottom=537,overlays=records),indent=2)+'\n')
    preview=Image.new('RGB',(1920,1080),(19,47,35))
    preview.paste(overlays[-1],mask=overlays[-1].getchannel('A'))
    preview.save(ROOT/'preview_end_card.jpg',quality=95)
    sheet=Image.new('RGB',(1440,1390),(12,26,19))
    sd=ImageDraw.Draw(sheet)
    label_font=ImageFont.truetype(AVENIR,20,index=5)
    for idx,(overlay,item) in enumerate(zip(overlays,items)):
        col,row=idx%2,idx//2
        x,y=col*720,row*456
        bg=Image.new('RGBA',(1920,1080),(25,56,41,255))
        # Quiet gradient to expose antialiasing and letterforms on forest tone.
        dd=ImageDraw.Draw(bg)
        for yy in range(1080):
            t=yy/1080
            dd.line((0,yy,1920,yy),fill=(round(29-14*t),round(67-32*t),round(47-23*t),255))
        bg.alpha_composite(overlay)
        sheet.paste(bg.resize((700,394),Image.Resampling.LANCZOS).convert('RGB'),(x+10,y+10))
        sd.text((x+18,y+412),f'{item[0]}  /  {item[1]:g}–{item[2]:g}s',font=label_font,fill=(219,217,193))
    sd.text((734,947),'BeriGame / Cinematic trailer',font=label_font,fill=(237,218,179))
    sd.text((734,985),'Transparent 1920 × 1080 overlays',font=label_font,fill=(175,194,178))
    sd.text((734,1023),'Georgia · Avenir Next · original berry motif',font=label_font,fill=(175,194,178))
    sheet.save(ROOT/'contact_sheet.jpg',quality=95)
    print(json.dumps(records,indent=2))

if __name__=='__main__':
    main()
