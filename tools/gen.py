# Builds C:/SageCanyonDrive/js/mapdata.js and assets/ground.jpg from the traced roads and the map's building masks.
import json, math, base64, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd

OUT = 'C:/SageCanyonDrive/'
S = 0.62                     # metres per map pixel
PW, PH = 1352, 1361          # map size in pixels
OX, OY = 676, 680            # map pixel at world origin
random.seed(7); np.random.seed(7)

def W(p): return ((p[0] - OX) * S, (p[1] - OY) * S)

# ---------- roads ----------
raw = json.load(open('roads.json'))
WID = {'Carmel Mountain Rd': 22, 'Harvest Run Dr': 12.5, 'Cherry Hill Dr': 11, 'Foxhound Way': 11, 'Ridge Dr': 10.5,
       'Hunters Glen Dr': 11, 'Havenridge Way': 10, 'Quaker Hill Ln': 10, 'Whispering Hills Ln': 10, 'Gaylemont Ln': 10,
       'Spur Point Ct': 9.5, 'Birch Hill Point': 9, 'Village Haven Trl': 9.5, 'Sage Canyon School': 7, '': 10}
polys = []
for name, wpx, pts in raw:
    w = WID.get(name, 10)
    if wpx <= 16: w = min(w, 9)
    if name == 'Harvest Run Dr' and wpx < 20: w = 9
    polys.append({'name': name, 'w': w, 'pts': [list(map(float, W(p))) for p in pts]})
polys[-1]['oneway'] = True   # school drop-off loop

def proj(p, a, b):
    ax, az = a; bx, bz = b; dx, dz = bx - ax, bz - az
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L))
    q = (ax + dx * t, az + dz * t)
    return math.hypot(p[0] - q[0], p[1] - q[1]), t, q

# snap endpoints onto other roads (and insert a shared vertex there)
for i, P in enumerate(polys):
    for end in (0, -1):
        p = P['pts'][end]
        best = None
        for j, Q in enumerate(polys):
            if j == i: continue
            for k in range(len(Q['pts']) - 1):
                d, t, q = proj(p, Q['pts'][k], Q['pts'][k + 1])
                if best is None or d < best[0]: best = (d, j, k, t, q)
        if best and best[0] < 4.5:
            d, j, k, t, q = best
            Q = polys[j]
            # reuse a nearby existing vertex
            near = [m for m in range(len(Q['pts'])) if math.dist(Q['pts'][m], q) < 2.0]
            if near: q = Q['pts'][near[0]]
            else: Q['pts'].insert(k + 1, [q[0], q[1]]); q = Q['pts'][k + 1]
            P['pts'][end] = [q[0], q[1]]

key = lambda p: (round(p[0], 1), round(p[1], 1))
for P in polys:
    q = [P['pts'][0]]
    for p in P['pts'][1:]:
        if math.dist(p, q[-1]) > 0.5: q.append(p)
    P['pts'] = q
use = {}
for i, P in enumerate(polys):
    for m, p in enumerate(P['pts']):
        use.setdefault(key(p), set()).add(i)
nodes, nodeIx = [], {}
def node(p):
    k = key(p)
    if k not in nodeIx: nodeIx[k] = len(nodes); nodes.append([round(p[0], 2), round(p[1], 2)])
    return nodeIx[k]
edges = []
for i, P in enumerate(polys):
    pts = P['pts']; start = 0
    for m in range(1, len(pts)):
        if m == len(pts) - 1 or len(use[key(pts[m])]) > 1:
            seg = pts[start:m + 1]
            L = sum(math.dist(seg[n], seg[n + 1]) for n in range(len(seg) - 1))
            edges.append({'a': node(seg[0]), 'b': node(seg[-1]), 'r': i, 'len': round(L, 2),
                          'pts': [[round(x, 2), round(z, 2)] for x, z in seg]})
            start = m
deg = [0] * len(nodes)
for e in edges: deg[e['a']] += 1; deg[e['b']] += 1
xmin, xmax = (0 - OX) * S, (PW - OX) * S
zmin, zmax = (0 - OY) * S, (PH - OY) * S
def atEdge(p): return p[0] < xmin + 8 or p[0] > xmax - 8 or p[1] < zmin + 8 or p[1] > zmax - 8
dead = [n for n in range(len(nodes)) if deg[n] == 1 and not atEdge(nodes[n])]
ends = [n for n in range(len(nodes)) if deg[n] == 1 and atEdge(nodes[n])]
print('nodes', len(nodes), 'edges', len(edges), 'dead', len(dead), 'ends', len(ends))

def roadDist(p, skip=None):
    best = (1e9, None, 0, None)
    for i, P in enumerate(polys):
        if i == skip: continue
        pts = P['pts']; acc = 0
        for k in range(len(pts) - 1):
            d, t, q = proj(p, pts[k], pts[k + 1])
            seg = math.dist(pts[k], pts[k + 1])
            if d - P['w'] / 2 < best[0]:
                dx, dz = pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]
                side = 1 if (dx * (p[1] - pts[k][1]) - dz * (p[0] - pts[k][0])) > 0 else -1
                best = (d - P['w'] / 2, i, acc + t * seg, q, side, d)
            acc += seg
    return best

# ---------- buildings ----------
blds_raw = json.load(open('blds.json'))
blds = []
def inSchool(x, y): return 430 < x < 725 and 640 < y < 800 and not (x > 690 and y > 700)
for cx, cy, w, h, deg_, fill, area in blds_raw:
    if min(w, h) < 9: continue
    t = math.radians(deg_)
    school = inSchool(cx, cy)
    if not school and fill < 0.55: continue
    long_, short = (w, h) if w >= h else (h, w)
    axis = t if w >= h else t + math.pi / 2
    n = 1
    if not school and long_ > 1.7 * max(short, 26): n = max(1, round(long_ / max(short * 1.05, 28)))
    for k in range(n):
        off = (k - (n - 1) / 2) * long_ / n
        px, py = cx + math.cos(axis) * off, cy + math.sin(axis) * off
        L = long_ / n
        bw, bd = (L * 0.9, short * 0.94) if n > 1 else (long_, short)
        x, z = W((px, py))
        blds.append({'x': x, 'z': z, 'w': bw * S * 0.94, 'd': bd * S * 0.94, 'ang': axis, 'school': school})
# drop anything sitting on a road; set the front toward the nearest road
kept = []
for b in blds:
    rd = roadDist((b['x'], b['z']))
    r = max(b['w'], b['d']) / 2
    if rd[0] < min(b['w'], b['d']) * 0.35 + 1.5: continue
    if rd[1] == 0 and not b['school']:
        alt = roadDist((b['x'], b['z']), skip=0)
        if alt[0] < 40: rd = alt
    q = rd[3]
    b['front'] = math.atan2(q[0] - b['x'], q[1] - b['z'])
    b['road'] = rd[1]; b['t'] = rd[2]; b['side'] = rd[4]; b['rd'] = rd[0]
    kept.append(b)
blds = kept
print('buildings', len(blds))

# addresses: real-looking numbers along each road, odd on one side, even on the other
names = {}
for b in blds:
    if b['school']: continue
    nm = polys[b['road']]['name']
    if not nm or nm == 'Sage Canyon School': continue
    base = 12000 + (sum(map(ord, nm)) * 37 % 9) * 100
    acc_off = sum(sum(math.dist(polys[i]['pts'][k], polys[i]['pts'][k + 1]) for k in range(len(polys[i]['pts']) - 1))
                  for i in range(b['road']) if polys[i]['name'] == nm)
    num = base + int((b['t'] + acc_off) / 7.5) * 2 + (1 if b['side'] > 0 else 0)
    while (nm, num) in names: num += 2
    names[(nm, num)] = 1
    b['addr'] = [num, nm]

# ---------- terrain ----------
im = np.array(Image.open('C:/pics/map.jpg').convert('RGB')).astype(int)[:PH, :PW]
r, g, bb = im[..., 0], im[..., 1], im[..., 2]
green = (g - r > 22) & (g - bb > 8)
green[1240:, 0:160] = green[1240:, 160:161]  # under the Layers button: copy a neighbour column
green[1180:, 1100:] = True
green[1325:, 500:800] = True   # the map's logo
holes = nd.binary_fill_holes(green) & ~green
hl, hn = nd.label(holes)
hs = nd.sum(holes, hl, range(1, hn + 1))
green |= np.isin(hl, 1 + np.where(hs < 2500)[0])
lab, n = nd.label(green)
park_id = lab[660, 300]
park = lab == park_id
# road raster (pixels) for keeping canyons off the roads
rimg = Image.new('L', (PW, PH), 0); rd_ = ImageDraw.Draw(rimg)
for P in polys:
    pp = [((x / S) + OX, (z / S) + OY) for x, z in P['pts']]
    wpx = (P['w'] + 4) / S
    rd_.line(pp, fill=255, width=int(wpx), joint='curve')
    for q in pp: rd_.ellipse([q[0] - wpx / 2, q[1] - wpx / 2, q[0] + wpx / 2, q[1] + wpx / 2], fill=255)
roadpx = np.array(rimg) > 0
canyon = green & ~park & ~roadpx
dist = nd.distance_transform_edt(canyon) * S
CELL = 4
gx, gz = PW // CELL + 1, PH // CELL + 1
small = np.zeros((gz, gx))
dpx = np.pad(dist, ((0, CELL), (0, CELL)), mode='edge')
for j in range(gz):
    for i in range(gx):
        small[j, i] = dpx[j * CELL, i * CELL]
depth = np.minimum(np.maximum(0, small - 3) * 0.42, 24)
noise = nd.gaussian_filter(np.random.rand(gz, gx), 6) - 0.5
depth = depth * (1 + noise * 0.8)
depth = nd.gaussian_filter(depth, 1.2)
dev = ~nd.zoom(canyon.astype(float), 1 / CELL, order=0)[:gz, :gx].astype(bool)
height = -depth
hq = np.clip(np.round(-height * 4), 0, 255).astype(np.uint8)   # quarter metres below street level
print('max depth', depth.max())

# ---------- ground texture ----------
TS = 4096
sx, sy = TS / PW, TS / PH
def T(p): return ((p[0] / S + OX) * sx, (p[1] / S + OY) * sy)
tex = np.zeros((TS, TS, 3), np.float32)
big = lambda m: np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((TS, TS), Image.BILINEAR)) / 255.0
cany = big(canyon.astype(float)); parkm = big(park.astype(float))
n1 = np.array(Image.fromarray((np.random.rand(512, 512) * 255).astype(np.uint8)).resize((TS, TS), Image.BICUBIC)) / 255.0
n2 = np.array(Image.fromarray((np.random.rand(128, 128) * 255).astype(np.uint8)).resize((TS, TS), Image.BICUBIC)) / 255.0
n3 = np.random.rand(TS, TS)
lawn = np.stack([128 + 30 * n2 + 14 * n3, 146 + 24 * n2 + 14 * n3, 96 + 12 * n3], -1)
chap = np.stack([128 + 40 * n1 + 20 * n3, 122 + 30 * n1 + 16 * n3, 84 + 18 * n1 + 10 * n3], -1)
dark = (n1 > 0.55) & (n3 > 0.2)
chap[dark] *= 0.72
grass = np.stack([92 + 18 * n2 + 10 * n3, 160 + 20 * n2 + 10 * n3, 70 + 8 * n3], -1)
tex = lawn * (1 - cany[..., None]) + chap * cany[..., None]
tex = tex * (1 - parkm[..., None]) + grass * parkm[..., None]
ground = Image.fromarray(np.clip(tex, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(ground)
px_m = sx / S  # texture pixels per metre (approx)
# park: soccer field and path
fc = T(W((300, 650))); fw, fh = 95 * px_m, 60 * px_m
d.rectangle([fc[0] - fw / 2, fc[1] - fh / 2, fc[0] + fw / 2, fc[1] + fh / 2], outline=(236, 240, 230), width=int(0.15 * px_m) + 2)
d.line([fc[0], fc[1] - fh / 2, fc[0], fc[1] + fh / 2], fill=(236, 240, 230), width=int(0.15 * px_m) + 2)
d.ellipse([fc[0] - 9 * px_m, fc[1] - 9 * px_m, fc[0] + 9 * px_m, fc[1] + 9 * px_m], outline=(236, 240, 230), width=int(0.15 * px_m) + 2)
# school: blacktop and the field from the satellite view
for poly in [[(445, 665), (560, 665), (560, 760), (445, 760)], [(565, 640), (700, 640), (700, 720), (565, 720)],
             [(560, 815), (675, 815), (675, 875), (560, 875)]]:
    d.polygon([T(W(p)) for p in poly], fill=(98, 98, 102))
for i in range(12):  # parking bays
    x = 570 + i * 9
    d.line([T(W((x, 818))), T(W((x, 838)))], fill=(230, 230, 230), width=3)
    d.line([T(W((x, 852))), T(W((x, 872)))], fill=(230, 230, 230), width=3)
# driveways
for b in blds:
    if b['school'] or b['rd'] > 18: continue
    fx, fz = math.sin(b['front']), math.cos(b['front'])
    hx, hz = b['x'] + fx * b['d'] * 0.3, b['z'] + fz * b['d'] * 0.3
    ex, ez = b['x'] + fx * (b['rd'] + 0.4), b['z'] + fz * (b['rd'] + 0.4)
    gx_, gz_ = -fz * 1.6, fx * 1.6
    pts = [(hx + gx_ - fz * 1.2, hz + gz_ + fx * 1.2), (hx - gx_ - fz * 1.2, hz - gz_ + fx * 1.2), (ex - gx_ - fz * 1.2, ez - gz_ + fx * 1.2), (ex + gx_ - fz * 1.2, ez + gz_ + fx * 1.2)]
    d.polygon([T(p) for p in pts], fill=(196, 192, 182))
    b['drive'] = [round(ex - fz * 1.2, 2), round(ez + fx * 1.2, 2)]
def strip(P, half, col):
    pp = [T(p) for p in P['pts']]
    wpx = int(2 * half * px_m)
    d.line(pp, fill=col, width=wpx, joint='curve')
    for q in pp: d.ellipse([q[0] - half * px_m, q[1] - half * px_m, q[0] + half * px_m, q[1] + half * px_m], fill=col)
for P in polys: strip(P, P['w'] / 2 + (2.2 if P['name'] != 'Sage Canyon School' else 0.8), (206, 204, 198))   # sidewalk
for P in polys: strip(P, P['w'] / 2 + 0.25, (150, 150, 150))   # curb/gutter
for n_ in dead:
    q = T(nodes[n_]); P = polys[[e for e in edges if e['a'] == n_ or e['b'] == n_][0]['r']]
    rr = (P['w'] * 0.9 + 2.2) * px_m
    d.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=(206, 204, 198))
    rr = (P['w'] * 0.9) * px_m
    d.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=(150, 150, 150))
for P in polys: strip(P, P['w'] / 2, (74, 75, 79))   # asphalt
for n_ in dead:
    q = T(nodes[n_]); P = polys[[e for e in edges if e['a'] == n_ or e['b'] == n_][0]['r']]
    rr = (P['w'] * 0.9 - 0.25) * px_m
    d.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=(74, 75, 79))
    nodes_dead_r = rr
gimg = np.array(ground).astype(np.float32)
# asphalt grain
asp = (np.abs(gimg - np.array([74, 75, 79])).sum(-1) < 3)
gimg[asp] += (n3[asp, None] * 16 - 8) + (n1[asp, None] * 10 - 5)
ground = Image.fromarray(np.clip(gimg, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(ground)

def offsetLine(pts, off):
    out = []
    for k in range(len(pts)):
        a = pts[max(0, k - 1)]; b = pts[min(len(pts) - 1, k + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1
        out.append((pts[k][0] - dz / L * off, pts[k][1] + dx / L * off))
    return out
def dashes(pts, on, off_, col, wid):
    acc = 0; draw = True; seg = [pts[0]]
    k = 0; cur = pts[0]
    while k < len(pts) - 1:
        nxt = pts[k + 1]; L = math.dist(cur, nxt)
        lim = on if draw else off_
        if acc + L >= lim:
            t = (lim - acc) / L
            pt = (cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t)
            if draw: d.line([T(p) for p in seg + [pt]], fill=col, width=wid)
            draw = not draw; acc = 0; seg = [pt]; cur = pt
        else:
            acc += L; seg.append(nxt); cur = nxt; k += 1
    if draw and len(seg) > 1: d.line([T(p) for p in seg], fill=col, width=wid)

junction = [n_ for n_ in range(len(nodes)) if deg[n_] >= 3]
def nearJunction(p, r):
    return any(math.dist(p, nodes[j]) < r for j in junction)
def trimmed(pts, r):
    # split the polyline where it passes junctions so markings stop short of intersections
    out, cur = [], []
    fine = []
    for k in range(len(pts) - 1):
        a, b = pts[k], pts[k + 1]; L = math.dist(a, b); n_ = max(1, int(L / 1.5))
        for s in range(n_): fine.append((a[0] + (b[0] - a[0]) * s / n_, a[1] + (b[1] - a[1]) * s / n_))
    fine.append(tuple(pts[-1]))
    for p in fine:
        if nearJunction(p, r):
            if len(cur) > 1: out.append(cur)
            cur = []
        else: cur.append(p)
    if len(cur) > 1: out.append(cur)
    return out
LW = max(3, int(0.15 * px_m))
for P in polys:
    pts = [tuple(p) for p in P['pts']]
    if P['name'] == 'Carmel Mountain Rd':
        for part in trimmed(pts, 16):
            for sgn in (1, -1):
                med = offsetLine(part, sgn * 2.0)
                d.line([T(p) for p in med], fill=(226, 196, 60), width=LW)
                dashes(offsetLine(part, sgn * 5.8), 3, 9, (236, 236, 236), LW)
                d.line([T(p) for p in offsetLine(part, sgn * 9.4)], fill=(236, 236, 236), width=LW)
            # raised median with grass
            d.line([T(p) for p in part], fill=(160, 158, 150), width=int(3.4 * px_m))
            d.line([T(p) for p in part], fill=(110, 140, 80), width=int(2.8 * px_m))
    elif P['name'] in ('Harvest Run Dr',) and P['w'] > 10:
        for part in trimmed(pts, 9):
            for sgn in (1, -1):
                d.line([T(p) for p in offsetLine(part, sgn * 0.18)], fill=(226, 196, 60), width=LW)
    elif P['w'] >= 10.5 and P['name']:
        for part in trimmed(pts, 9):
            dashes(part, 3, 9, (226, 196, 60), LW)
# crosswalks and stop bars
stops, xwalks = [], []
for e in edges:
    for endn, idx, nxt in ((e['a'], 0, 1), (e['b'], -1, -2)):
        if deg[endn] < 3: continue
        P = polys[e['r']]
        others = [polys[f['r']] for f in edges if f is not e and (f['a'] == endn or f['b'] == endn)]
        wmax = max(o['w'] for o in others)
        major = P['w'] < wmax - 0.5 or (P['w'] <= wmax and all(o['name'] == others[0]['name'] for o in others) and others[0]['name'] != P['name'])
        p0 = e['pts'][idx]; p1 = e['pts'][nxt]
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(dx, dz); dx /= L; dz /= L
        back = wmax / 2 + 2.6
        cx, cz = p0[0] + dx * back, p0[1] + dz * back
        nx, nz = -dz, dx
        big_ = P['name'] == 'Carmel Mountain Rd' or any(o['name'] == 'Carmel Mountain Rd' for o in others) or (endn in [nodeIx.get(key(W((548, 872)))), ])
        if big_ or P['w'] >= 12:
            # zebra crosswalk
            for s in np.arange(-P['w'] / 2 + 0.6, P['w'] / 2, 1.2):
                a = (cx + nx * s, cz + nz * s)
                d.line([T((a[0] - dx * 1.5, a[1] - dz * 1.5)), T((a[0] + dx * 1.5, a[1] + dz * 1.5))], fill=(236, 236, 236), width=int(0.55 * px_m))
            xwalks.append([round(cx, 2), round(cz, 2), round(math.atan2(dx, dz), 3), P['w']])
        if P['w'] < wmax - 0.5 or (major and P['name'] != 'Carmel Mountain Rd'):
            sx_, sz_ = cx + dx * 2.2, cz + dz * 2.2
            # stop bar on the incoming (right-hand) half
            a = (sx_, sz_); b = (sx_ + nx * (-P['w'] / 2), sz_ + nz * (-P['w'] / 2))
            d.line([T(a), T(b)], fill=(236, 236, 236), width=int(0.45 * px_m))
            if P['w'] <= 11:
                tp = (sx_ - dx * 0.4 - nx * (P['w'] / 2 - 1.6), sz_ - dz * 0.4 - nz * (P['w'] / 2 - 1.6))
            stops.append([round(sx_ + nx * (-P['w'] / 2 - 1.2), 2), round(sz_ + nz * (-P['w'] / 2 - 1.2), 2), round(math.atan2(-dx, -dz), 3), endn, edges.index(e), 0 if idx == 0 else 1])
signal_nodes = [nodeIx[key(W(p))] for p in [(90, 645), (1005, 562)] if key(W(p)) in nodeIx]
print('stops', len(stops), 'xwalks', len(xwalks), 'signals', signal_nodes)
# SCHOOL text on the road near the school
ground = ground.filter(ImageFilter.GaussianBlur(0.6))
ground.save(OUT + 'assets/ground.jpg', quality=84, optimize=True)

# ---------- trees ----------
trees = []  # [x,z,kind]  0 round 1 palm 2 pine 3 bush
def okTree(p, clr):
    rd = roadDist(p)
    if rd[0] < clr: return False
    for b in blds:
        if abs(b['x'] - p[0]) < 14 and abs(b['z'] - p[1]) < 14:
            c, s = math.cos(-b['ang']), math.sin(-b['ang'])
            # building local frame (ang rotates image x toward image y = world x toward z)
            lx = (p[0] - b['x']) * math.cos(b['ang']) + (p[1] - b['z']) * math.sin(b['ang'])
            lz = -(p[0] - b['x']) * math.sin(b['ang']) + (p[1] - b['z']) * math.cos(b['ang'])
            if abs(lx) < b['w'] / 2 + 1.6 and abs(lz) < b['d'] / 2 + 1.6: return False
        if 'drive' in b and math.dist(b['drive'], p) < 3.5: return False
    return True
for P in polys:
    if P['name'] == 'Sage Canyon School': continue
    pts = P['pts']
    for side in (1, -1):
        line = offsetLine([tuple(p) for p in pts], side * (P['w'] / 2 + 3.6))
        acc = random.random() * 10
        for k in range(len(line) - 1):
            a, b = line[k], line[k + 1]; L = math.dist(a, b); t = acc
            while t < L:
                p = (a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)
                if not nearJunction(p, P['w'] + 6) and okTree(p, 2.4):
                    kind = 1 if (P['name'] == 'Carmel Mountain Rd' and random.random() < 0.4) else (2 if P['name'] == 'Carmel Mountain Rd' else (1 if random.random() < 0.25 else 0))
                    trees.append([round(p[0], 1), round(p[1], 1), kind])
                t += 13 + random.random() * 9
            acc = t - L
    if P['name'] == 'Carmel Mountain Rd':
        for part in trimmed([tuple(p) for p in pts], 18):
            for k in range(0, len(part), 9):
                trees.append([round(part[k][0], 1), round(part[k][1], 1), 2])
# yard trees
for b in blds:
    if b['school'] or random.random() < 0.35: continue
    bx = -math.sin(b['front']); bz = -math.cos(b['front'])
    p = (b['x'] + bx * (b['d'] / 2 + 3) + random.uniform(-3, 3), b['z'] + bz * (b['d'] / 2 + 3) + random.uniform(-3, 3))
    if okTree(p, 3): trees.append([round(p[0], 1), round(p[1], 1), 1 if random.random() < 0.3 else 0])
# park trees around the field edge
for k in range(60):
    a = random.random() * math.tau
    p = W((300 + math.cos(a) * random.uniform(120, 220), 650 + math.sin(a) * random.uniform(60, 110)))
    j, i = int(p[1] / S + OY), int(p[0] / S + OX)
    if 0 <= j < PH and 0 <= i < PW and park[j, i] and okTree(p, 4): trees.append([round(p[0], 1), round(p[1], 1), 0])
# canyon brush: chaparral bushes, a few oaks and eucalyptus
cy_, cx_ = np.nonzero(canyon[::6, ::6])
for j, i in zip(cy_, cx_):
    if random.random() < 0.45:
        p = W((i * 6 + random.uniform(-3, 3), j * 6 + random.uniform(-3, 3)))
        trees.append([round(p[0], 1), round(p[1], 1), 3 if random.random() < 0.88 else (0 if random.random() < 0.6 else 2)])
print('trees', len(trees))

def r2(v): return round(v, 2)
data = {
    'S': S, 'xmin': r2(xmin), 'xmax': r2(xmax), 'zmin': r2(zmin), 'zmax': r2(zmax),
    'roads': [{'name': P['name'], 'w': P['w'], 'pts': [[r2(x), r2(z)] for x, z in P['pts']], **({'oneway': 1} if P.get('oneway') else {})} for P in polys],
    'nodes': nodes, 'edges': edges, 'dead': dead, 'ends': ends, 'signals': signal_nodes,
    'stops': stops, 'xwalks': xwalks,
    'blds': [[r2(b['x']), r2(b['z']), r2(b['w']), r2(b['d']), round(b['ang'], 3), 1 if b['school'] else 0, round(b['front'], 3),
              b.get('addr', [0, ''])[0], b.get('addr', [0, ''])[1], b.get('drive', None)] for b in blds],
    'trees': trees,
    'hgt': {'nx': int(gx), 'nz': int(gz), 'cell': CELL * S, 'b64': base64.b64encode(hq.tobytes()).decode()},
    'school': [r2(v) for v in W((600, 730))], 'park': [r2(v) for v in W((300, 650))],
}
open(OUT + 'js/mapdata.js', 'w', encoding='utf-8').write('// Generated from a traced street map of Sage Canyon (Carmel Valley, San Diego). Do not edit by hand.\nexport const MAP = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('ok')
