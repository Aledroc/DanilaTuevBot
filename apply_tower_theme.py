with open('miniapp/games/tower/main.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update U to use block's theme
old_u = 'U=function(t,e){var i=t.perfect,a=e.getImg(i?"block-perfect":"block");e.ctx.drawImage(a,t.x,t.y,t.width,t.height)}'
new_u = 'U=function(t,e){var i=t.perfect,k=t.floorTheme||"block-gym",m=i?k+"-perfect":k,a=e.getImg(m)||e.getImg(i?"block-perfect":"block");e.ctx.drawImage(a,t.x,t.y,t.width,t.height)}'

# 2. Update block creation in Y to assign floorTheme
old_create = 'var r=new f({name:"block_".concat(t.getVariable("BLOCK_COUNT")),action:H,painter:W});'
new_create = 'var bc=t.getVariable("BLOCK_COUNT"),th=["block-gym","block-bar","block-dungeon","block-club","block-boss"][bc%5],r=new f({name:"block_".concat(bc),action:H,painter:W});r.blockIndex=bc;r.floorTheme=th;'

# 3. Preload all theme images
old_load = 's.addImg("block",n("block.png")),s.addImg("block-perfect",n("block-perfect.png"));'
new_load = 's.addImg("block",n("block.png")),s.addImg("block-perfect",n("block-perfect.png")),["gym","bar","dungeon","club","boss"].forEach(function(v){s.addImg("block-"+v,n("block-"+v+".png")),s.addImg("block-"+v+"-perfect",n("block-"+v+"-perfect.png"))});'

assert old_u in text, "old_u not found"
assert old_create in text, "old_create not found"
assert old_load in text, "old_load not found"

text_mod = text.replace(old_u, new_u).replace(old_create, new_create).replace(old_load, new_load)

with open('miniapp/games/tower/main.js', 'w', encoding='utf-8') as f:
    f.write(text_mod)

with open('miniapp/games/tower/dist/main.js', 'w', encoding='utf-8') as f:
    f.write(text_mod)

print("Updated main.js and dist/main.js successfully!")
