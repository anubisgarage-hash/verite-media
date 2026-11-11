// Instagram用の縦長画像を描く（投稿チェックの画面と同じ描き方）。ブラウザ内で実行する。
function wrapLines(ctx, text, maxW, maxLines){
  const lines=[]; let line='';
  for(const ch of [...text]){
    const t=line+ch;
    if(ctx.measureText(t).width>maxW && line && !'、。，．）」』】！？ぁぃぅぇぉっゃゅょゎァィゥェォッャュョーｰ…'.includes(ch)){ lines.push(line); line=ch; } else line=t;
  }
  if(line) lines.push(line);
  if(lines.length>maxLines){ lines.length=maxLines; lines[maxLines-1]=lines[maxLines-1].slice(0,-1)+'…'; }
  return lines;
}
function drawInsta(img, brand){
  const W=1080,H=1350,c=document.createElement('canvas'); c.width=W; c.height=H;
  const x=c.getContext('2d'), pal=brand?.palette||{bg:'#16233A',ink:'#F4EFEA',accent:'#E8775F',sub:'#3FA59A',paper:'#F6F1EC'};
  const name=(brand?.name||'').toUpperCase();
  const disp='"Shippori Mincho B1","Hiragino Mincho ProN",serif', goth='"Zen Kaku Gothic New","Hiragino Sans",sans-serif';
  const dark = img.style!=='paper' && img.style!=='check';
  const bg = dark?pal.bg:pal.paper, ink = dark?pal.ink:pal.bg;
  x.fillStyle=bg; x.fillRect(0,0,W,H);
  // V + ring mark
  x.strokeStyle=pal.accent; x.lineCap='round';
  x.lineWidth=7; x.beginPath(); x.moveTo(870,110); x.lineTo(920,240); x.lineTo(970,110); x.stroke();
  x.lineWidth=4; x.beginPath(); x.arc(920,290,30,0,Math.PI*2); x.stroke();
  if(dark){ x.globalAlpha=.07; x.lineWidth=2; for(let r=140;r<900;r+=80){ x.beginPath(); x.arc(920,290,r,0,Math.PI*2); x.stroke(); } x.globalAlpha=1; }
  x.fillStyle=pal.accent; x.fillRect(90,140,70,6);
  x.fillStyle=ink; x.globalAlpha=.75; x.font=`700 26px ${goth}`; x.fillText(name,90,200); x.globalAlpha=1;
  if(img.style==='check'){
    x.fillStyle=ink; x.font=`800 78px ${disp}`;
    const L=wrapLines(x,img.headline,880,2); L.forEach((l,i)=>x.fillText(l,90,400+i*104));
    const items=(img.sub||'').split('|').filter(Boolean).slice(0,3);
    items.forEach((t,i)=>{ const y=400+L.length*104+120+i*150;
      x.strokeStyle=pal.sub; x.lineWidth=6; x.strokeRect(90,y-56,70,70);
      x.beginPath(); x.moveTo(104,y-22); x.lineTo(122,y-4); x.lineTo(150,y-44); x.stroke();
      x.fillStyle=ink; x.font=`700 44px ${goth}`; wrapLines(x,t,780,2).forEach((l,j)=>x.fillText(l,195,y-4+j*56)); });
  } else {
    x.fillStyle=ink; x.font=`800 92px ${disp}`;
    const L=wrapLines(x,img.headline,880,5); const top=520-(L.length-1)*55;
    L.forEach((l,i)=>x.fillText(l,90,top+i*122));
    x.fillStyle=pal.accent; x.font=`500 42px ${goth}`;
    wrapLines(x,img.sub||'',880,2).forEach((l,i)=>x.fillText(l,90,top+L.length*122+40+i*58));
  }
  // footer CTA
  x.fillStyle=dark?pal.accent:pal.bg; x.fillRect(0,H-150,W,150);
  x.fillStyle=dark?pal.bg:pal.paper; x.font=`700 38px ${goth}`; x.textAlign='center';
  x.fillText('続きは、プロフィールのリンクから',W/2,H-62); x.textAlign='left';
  return c;
}
window.drawInsta = drawInsta;
