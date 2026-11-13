#!/usr/bin/env python3
"""Draw the Bit Browser logo (the "Bit Globe": a pixel globe with an orange
ring and an orange B, drawn as 128x128 pixel art) and write every size the
desktop installers, the phone apps and the in-app logo need.

Run: python3 scripts/make-icons.py   (needs Pillow)"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N=128
# palette (Bit colors + shades)
BG0=(11,11,22); BG1=(20,20,40); BG2=(34,30,64); BG3=(52,42,96)
T0=(8,74,66); T1=(14,124,111); T2=(45,212,191); T3=(150,245,225); T4=(230,255,250)
O0=(122,62,0); O1=(196,108,10); O2=(255,159,28); O3=(255,214,120)
INK=(244,241,255); OUT=(5,5,15); G1=(70,70,110); G2=(110,110,160); G3=(170,170,210); P1=(255,93,143); PU=(192,132,252)

def canvas(): return Image.new('RGBA',(N,N),(0,0,0,0))
def mask_from(fn):
    m=Image.new('L',(N,N),0); fn(ImageDraw.Draw(m)); return m
def fill(img, m, color): img.paste(Image.new('RGBA',(N,N),color+(255,)),(0,0),m)
def outline(img, m, color=OUT, w=1):
    big=m
    for _ in range(w): big=big.filter(ImageFilter.MaxFilter(3))
    ring=ImageChops.subtract(big,m); fill(img, ring, color)
def bands(img, m, colors, axis='y', start=0, end=N):
    # posterized vertical/horizontal gradient inside mask
    n=len(colors); step=(end-start)/n
    for i,c in enumerate(colors):
        a=int(start+i*step); b=int(start+(i+1)*step)
        box=Image.new('L',(N,N),0); d=ImageDraw.Draw(box)
        if axis=='y': d.rectangle([0,a,N,b],fill=255)
        else: d.rectangle([a,0,b,N],fill=255)
        fill(img, ImageChops.multiply(m,box), c)
def shift(m,dx,dy): return ImageChops.offset(m,dx,dy)
def bg_tile():
    img=canvas()
    m=mask_from(lambda d:d.rounded_rectangle([4,4,123,123],radius=22,fill=255))
    bands(img,m,[BG3,BG2,BG2,BG1,BG1,BG0],'y',4,124)
    # inner highlight line top
    hl=mask_from(lambda d:d.rounded_rectangle([8,8,119,119],radius=18,outline=255,width=1))
    top=mask_from(lambda d:d.rectangle([0,0,N,40],fill=255))
    fill(img,ImageChops.multiply(hl,top),(80,70,140))
    outline(img,m,OUT,2)
    return img
def stars(img,pts,c=INK):
    d=ImageDraw.Draw(img)
    for x,y in pts:
        d.point([(x,y),(x-1,y),(x+1,y),(x,y-1),(x,y+1)],fill=c+(255,))
def B_mask(x,y,w,h,t):
    # chunky B: stem + two bowls with holes
    def draw(d):
        d.rectangle([x,y,x+t,y+h],fill=255)
        hh=h//2
        d.rounded_rectangle([x,y,x+w-6,y+hh+t//2],radius=t,fill=255)
        d.rounded_rectangle([x,y+hh-t//2,x+w,y+h],radius=t,fill=255)
        d.rounded_rectangle([x+t,y+t,x+w-6-t,y+hh-t//2],radius=max(2,t//3),fill=0)
        d.rounded_rectangle([x+t,y+hh+t//2,x+w-t,y+h-t],radius=max(2,t//3),fill=0)
    return mask_from(draw)
def shaded_B(img,x,y,w,h,t,light=T3,mid=T2,dark=T1,deep=T0):
    m=B_mask(x,y,w,h,t)
    sh=shift(m,4,5); fill(img,ImageChops.subtract(sh,m),deep)   # drop shadow
    bands(img,m,[light,mid,mid,mid,dark],'y',y,y+h+1)
    # top-left highlight edge
    edge=ImageChops.subtract(m,shift(m,1,1)); fill(img,edge,T4)
    outline(img,ImageChops.lighter(m,sh),OUT,1)
    return m
def cursor(img,x,y,s=10):
    m=mask_from(lambda d:d.rectangle([x,y,x+s,y+s],fill=255))
    bands(img,m,[O3,O2,O2,O1],'y',y,y+s+1); outline(img,m,OUT,1)
    ImageDraw.Draw(img).rectangle([x+2,y+2,x+3,y+3],fill=INK+(255,))

def logo1():
    img=bg_tile()
    shaded_B(img,30,24,62,76,15)
    cursor(img,96,92,12)
    stars(img,[(22,20),(104,30),(20,104)])
    return img
def logo2():
    img=bg_tile()
    c=mask_from(lambda d:d.ellipse([20,20,108,108],fill=255))
    # sphere shading: diagonal-ish bands via concentric offset circles
    fill(img,c,T1)
    for r,col in [(40,T2),(30,T3)]:
        cm=mask_from(lambda d,r=r:d.ellipse([52-r,50-r,52+r,50+r],fill=255))
        fill(img,ImageChops.multiply(c,cm),col)
    lines=mask_from(lambda d:(d.ellipse([44,20,84,108],outline=255,width=2),d.line([20,64,108,64],fill=255,width=2),d.arc([22,36,106,60],0,180,fill=255,width=2),d.arc([22,68,106,92],180,360,fill=255,width=2)))
    fill(img,ImageChops.multiply(c,lines),T0)
    outline(img,c,OUT,2)
    # orbit ring
    ring=mask_from(lambda d:d.ellipse([6,52,122,80],outline=255,width=4))
    front=mask_from(lambda d:d.rectangle([0,66,N,N],fill=255))
    behind=ImageChops.subtract(ring,front)
    fill(img,ImageChops.multiply(behind,ImageChops.invert(c)),O1)
    fill(img,ImageChops.multiply(ring,front),O2)
    shaded_B(img,46,38,38,50,10,light=O3,mid=O2,dark=O1,deep=O0)
    stars(img,[(18,22),(110,104)])
    return img
def logo3():
    img=bg_tile()
    body=mask_from(lambda d:(d.rounded_rectangle([26,14,102,110],radius=6,fill=255),d.rectangle([90,14,102,26],fill=0)))
    bands(img,body,[G3,G2,G2,G2,G1],'x',26,103)
    ridges=mask_from(lambda d:[d.line([32,y,96,y],fill=255) for y in range(18,26,3)])
    fill(img,ImageChops.multiply(body,ridges),G1)
    label=mask_from(lambda d:d.rounded_rectangle([34,30,94,90],radius=4,fill=255))
    bands(img,label,[BG3,BG2,BG1],'y',30,91); outline(img,label,OUT,1)
    shaded_B(img,46,38,36,44,9)
    stars(img,[(40,36),(88,84)],O3)
    pins=mask_from(lambda d:[d.rectangle([x,96,x+4,108],fill=255) for x in range(38,92,9)])
    fill(img,ImageChops.multiply(body,pins),O2)
    outline(img,body,OUT,2)
    return img
def logo4():
    img=bg_tile()
    head=mask_from(lambda d:d.rounded_rectangle([24,34,104,96],radius=14,fill=255))
    bands(img,head,[T3,T2,T2,T1,T0],'y',34,97); outline(img,head,OUT,2)
    ears=mask_from(lambda d:(d.rounded_rectangle([14,52,24,78],radius=3,fill=255),d.rounded_rectangle([104,52,114,78],radius=3,fill=255)))
    bands(img,ears,[O3,O2,O1],'y',52,79); outline(img,ears,OUT,1)
    ant=mask_from(lambda d:d.rectangle([62,16,66,34],fill=255)); fill(img,ant,G2); outline(img,ant,OUT,1)
    bulb=mask_from(lambda d:d.ellipse([56,6,72,22],fill=255)); bands(img,bulb,[O3,O2,O1],'y',6,23); outline(img,bulb,OUT,1)
    screen=mask_from(lambda d:d.rounded_rectangle([34,44,94,82],radius=8,fill=255)); fill(img,screen,BG0); outline(img,screen,OUT,1)
    eyes=mask_from(lambda d:(d.rounded_rectangle([44,52,56,66],radius=3,fill=255),d.rounded_rectangle([72,52,84,66],radius=3,fill=255)))
    bands(img,eyes,[T4,T3,T2],'y',52,67)
    smile=mask_from(lambda d:d.arc([50,58,78,76],20,160,fill=255,width=3)); fill(img,smile,O2)
    body=mask_from(lambda d:d.rounded_rectangle([40,96,88,120],radius=6,fill=255)); bands(img,body,[T2,T1,T0],'y',96,121); outline(img,body,OUT,2)
    shaded_B(img,56,99,16,18,4,light=O3,mid=O2,dark=O1,deep=O0)
    return img
def logo5():
    img=bg_tile()
    def shield(d,i=0):
        d.polygon([(24+i,16+i),(104-i,16+i),(104-i,62),(64,116-i),(24+i,62)],fill=255)
    outer=mask_from(shield); inner=mask_from(lambda d:shield(d,7))
    bands(img,outer,[T3,T2,T1,T1,T0],'x',24,105); outline(img,outer,OUT,2)
    bands(img,inner,[BG3,BG2,BG1,BG0],'y',23,110)
    rivets=mask_from(lambda d:[d.rectangle([x,y,x+2,y+2],fill=255) for x,y in [(28,20),(98,20),(28,58),(98,58)]]); fill(img,rivets,T4)
    shaded_B(img,42,30,42,54,11,light=O3,mid=O2,dark=O1,deep=O0)
    stars(img,[(92,32)])
    return img
def logo6():
    img=bg_tile()
    win=mask_from(lambda d:d.rounded_rectangle([16,22,112,106],radius=6,fill=255))
    fill(img,win,BG0); outline(img,win,OUT,2)
    bar=mask_from(lambda d:d.rounded_rectangle([16,22,112,36],radius=6,fill=255))
    bands(img,ImageChops.multiply(win,bar),[T3,T2,T1],'y',22,37)
    d=ImageDraw.Draw(img)
    for i,c in enumerate([P1,O2,T4]): d.rectangle([22+i*8,27,26+i*8,31],fill=c+(255,))
    addr=mask_from(lambda dd:dd.rectangle([50,26,104,32],fill=255)); fill(img,addr,BG1)
    shaded_B(img,36,44,46,54,12)
    # pixel arrow cursor
    arrow=mask_from(lambda dd:dd.polygon([(84,72),(84,104),(92,96),(98,108),(103,105),(97,94),(107,93)],fill=255))
    fill(img,arrow,INK); outline(img,arrow,OUT,1)
    stars(img,[(104,48),(26,96)],O3)
    return img

def globe(tile=True):
    img=bg_tile() if tile else canvas()
    c=mask_from(lambda d:d.ellipse([20,20,108,108],fill=255))
    # sphere shading: diagonal-ish bands via concentric offset circles
    fill(img,c,T1)
    for r,col in [(40,T2),(30,T3)]:
        cm=mask_from(lambda d,r=r:d.ellipse([52-r,50-r,52+r,50+r],fill=255))
        fill(img,ImageChops.multiply(c,cm),col)
    lines=mask_from(lambda d:(d.ellipse([44,20,84,108],outline=255,width=2),d.line([20,64,108,64],fill=255,width=2),d.arc([22,36,106,60],0,180,fill=255,width=2),d.arc([22,68,106,92],180,360,fill=255,width=2)))
    fill(img,ImageChops.multiply(c,lines),T0)
    outline(img,c,OUT,2)
    # orbit ring
    ring=mask_from(lambda d:d.ellipse([6,52,122,80],outline=255,width=4))
    front=mask_from(lambda d:d.rectangle([0,66,N,N],fill=255))
    behind=ImageChops.subtract(ring,front)
    fill(img,ImageChops.multiply(behind,ImageChops.invert(c)),O1)
    fill(img,ImageChops.multiply(ring,front),O2)
    shaded_B(img,46,38,38,50,10,light=O3,mid=O2,dark=O1,deep=O0)
    if tile: stars(img,[(18,22),(110,104)])
    return img


def scaled(img, size):
    return img.resize((size, size), Image.NEAREST)


def square_tile():
    """The globe on a full square background (stores round the corners themselves)."""
    img = canvas()
    full = Image.new('L', (N, N), 255)
    bands(img, full, [BG3, BG2, BG2, BG1, BG1, BG0], 'y', 0, N)
    sprite = globe(tile=False)
    img.paste(sprite, (0, 0), sprite)
    stars(img, [(18, 22), (110, 104)])
    return img


def padded(sprite, size, inner):
    """`sprite` scaled to `inner` px, centred on a transparent `size` px square."""
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    s = sprite.resize((inner, inner), Image.NEAREST)
    out.paste(s, ((size - inner) // 2, (size - inner) // 2), s)
    return out


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


tile = globe(tile=True)       # rounded pixel app-icon tile
sprite = globe(tile=False)    # just the globe, ring and B
square = square_tile()

# Desktop installers (Windows/Mac/Linux build their sizes from this).
save(scaled(tile, 1024), "apps", "desktop", "build", "icon.png")
# Phone app icon (iOS and the Android legacy icon).
save(scaled(square, 1024).convert("RGB"), "apps", "mobile", "assets", "icon.png")
# Android adaptive icon: background + foreground kept inside the safe middle ~66%.
bgimg = Image.new("RGBA", (1024, 1024), BG1 + (255,))
save(bgimg, "apps", "mobile", "assets", "android-icon-background.png")
save(padded(sprite, 1024, 780), "apps", "mobile", "assets", "android-icon-foreground.png")
# Themed (one-colour) icon: the dark outlines and the B's darkest parts become
# gaps, so the globe, ring and B still read in a single colour.
mono = padded(sprite, 1024, 780)
lum = mono.convert("L")
alpha = ImageChops.multiply(mono.getchannel("A"), lum.point(lambda v: 255 if v > 60 else 0))
bshape = padded(B_mask(46, 38, 38, 50, 10).convert("RGBA"), 1024, 780).getchannel("R")
alpha = ImageChops.subtract(alpha, bshape.filter(ImageFilter.MaxFilter(9)))
alpha = ImageChops.lighter(alpha, ImageChops.subtract(bshape, bshape.filter(ImageFilter.MinFilter(25))))
save(Image.merge("RGBA", (alpha.point(lambda a: 255), alpha.point(lambda a: 255), alpha.point(lambda a: 255), alpha)), "apps", "mobile", "assets", "android-icon-monochrome.png")
save(scaled(sprite, 512), "apps", "mobile", "assets", "splash-icon.png")
save(scaled(tile, 48), "apps", "mobile", "assets", "favicon.png")
# In-app logo (top bar, sidebar, settings) on phone and computer.
save(scaled(sprite, 128), "apps", "mobile", "assets", "logo.png")
save(scaled(sprite, 128), "apps", "desktop", "src", "ui", "img", "logo.png")
