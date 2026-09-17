const vertexSource = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  vUv=p;
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;

// A perspective ray is traced into a procedural celestial sphere or the lake.
// Sky, meteors and their reflections share exactly the same world directions.
const fragmentSource = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
uniform vec3 uEye;
uniform vec4 uRipples[4];
uniform vec4 uMeteorA[12];
uniform vec4 uMeteorB[12];
uniform vec4 uMeteorC[12];
uniform vec4 uMeteorD[12];
const float PI=3.14159265359;

float hash13(vec3 p){
  p=fract(p*.1031);
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
vec3 hash23(vec2 p){
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yxz+33.33);
  return fract((q.xxy+q.yzz)*q.zyx);
}
float noise3(vec3 p){
  vec3 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),
                 mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),
                 mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
const mat3 turn=mat3(.00,.80,.60,-.80,.36,-.48,-.60,-.48,.64);
float fbm(vec3 p){
  float v=0.0,a=.53;
  for(int i=0;i<5;i++){v+=a*noise3(p);p=turn*p*2.03+vec3(2.1,6.7,3.4);a*=.49;}
  return v;
}
float detailNoise(vec3 p){
  float v=0.0,a=.55;
  for(int i=0;i<3;i++){v+=a*noise3(p);p=turn*p*2.08+3.7;a*=.48;}
  return v;
}

float magnifiedDetail(vec3 p,float domainScale){
  // Fixed world-space frequencies become visible gradually as the view closes in.
  // Zero-mean residuals preserve the overall color and shape of the nebula.
  float zoom=tan(.575)/tan(uFov*.5);
  float budget=clamp(log2(max(zoom,1.0)),0.0,4.0);
  if(budget<=0.0)return 0.0;
  // Conservative angular bound includes the domain warp. It is valid on both
  // sides of the horizon, where screen derivatives in divergent branches are not.
  float footprint=2.0*tan(uFov*.5)/uResolution.y*domainScale;
  float residual=0.0,amplitude=.52;
  for(int i=0;i<4;i++){
    float weight=smoothstep(float(i),float(i+1),budget);
    weight*=1.0-smoothstep(.25,.75,footprint);
    if(weight<.001)break;
    residual+=amplitude*(noise3(p)-.5)*weight;
    p=turn*p*2.03+vec3(2.1,6.7,3.4);
    footprint*=2.03;amplitude*=.52;
  }
  return residual;
}

vec3 starLayer(vec3 d,float scale,float threshold){
  // Cube-face coordinates keep stars compact when looking straight up/down.
  vec3 ad=abs(d);
  vec2 uv;float face;
  if(ad.x>=ad.y&&ad.x>=ad.z){uv=d.zy/ad.x;face=d.x>0.0?0.0:1.0;}
  else if(ad.y>=ad.z){uv=d.xz/ad.y;face=d.y>0.0?2.0:3.0;}
  else{uv=d.xy/ad.z;face=d.z>0.0?4.0:5.0;}
  vec2 grid=(uv*.5+.5)*scale*.82;
  vec2 cell=floor(grid);
  vec3 rnd=hash23(cell+scale+face*71.13);
  vec2 q=fract(grid)-(.15+.7*rnd.xy);
  float exists=step(threshold,rnd.z);
  float brightness=fract(rnd.z*173.17);
  float worldRadius=mix(.025,.066,brightness);
  // Use the angular pixel footprint, avoiding derivatives across cube edges.
  float angularPixel=2.0*tan(uFov*.5)/uResolution.y;
  float major=max(max(ad.x,ad.y),ad.z);
  float pixelFootprint=max(angularPixel*scale*.41/(major*major),.0001);
  float radius=min(worldRadius,pixelFootprint*.80);
  float aa=pixelFootprint*.42;
  float r=length(q);
  float pin=exp(-r*r/max(radius*radius,aa*aa))*radius*radius/max(radius*radius,aa*aa);
  float halo=exp(-r*max(24.0,1.0/(pixelFootprint*2.8)))*.12;
  float cross=(exp(-abs(q.x)*120.0-abs(q.y)*14.0)+exp(-abs(q.y)*120.0-abs(q.x)*14.0));
  cross*=smoothstep(.87,1.0,brightness)*.32;
  float twinkle=.8+.2*sin(uTime*(.7+rnd.x)+rnd.z*81.0);
  vec3 tint=mix(vec3(.52,.76,1.0),vec3(1.0,.76,.94),rnd.x);
  tint=mix(tint,vec3(1.0),brightness*.6);
  return tint*(pin+halo+cross)*exists*twinkle*(.75+brightness*3.1);
}

vec3 meteorLight(vec3 d){
  vec3 light=vec3(0);
  float pixelAngle=2.0*tan(uFov*.5)/uResolution.y;
  for(int i=0;i<12;i++){
    vec4 shape=uMeteorC[i];
    if(shape.w<=0.0)continue;
    // Reject outside the flight's spherical cap before evaluating its trail.
    // This also excludes the antipodal copy of the great circle.
    if(dot(d,uMeteorD[i].xyz)<uMeteorD[i].w)continue;
    vec3 origin=uMeteorA[i].xyz,tangent=uMeteorB[i].xyz;
    float age=uMeteorA[i].w,flight=uMeteorB[i].w;
    float along=atan(dot(d,tangent),dot(d,origin));
    float across=dot(d,cross(origin,tangent));
    float speed=shape.x/flight;
    float deposited=clamp(along/speed,0.0,flight);
    float wakeAge=age-deposited;
    float emission=deposited/flight;
    float born=smoothstep(0.0,.085,emission);
    float burnout=1.0-smoothstep(.76,1.0,emission);
    float depositedLight=born*burnout;
    float width=.00022+shape.w*.00015;
    float aa=pixelAngle*.43;
    vec3 tint=mix(vec3(.24,.66,1.0),vec3(.69,.36,1.0),shape.z);

    if(along>=0.0&&along<=shape.x&&wakeAge>=0.0&&wakeAge<shape.y){
      // Every point ages from when the head passed it. The afterglow stays in
      // world space after burnout, widening and drifting very slightly as gas.
      float old=smoothstep(.08,.6,wakeAge);
      float drift=sin(along*23.0+shape.z*17.0+age*.7)*old*wakeAge*.0008;
      float side=across-drift;
      float coreWidth=width*mix(1.0,.28,clamp(wakeAge/.30,0.0,1.0));
      float variance=coreWidth*coreWidth+aa*aa;
      float core=exp(-side*side/variance)*coreWidth/sqrt(variance)*exp(-wakeAge/.14);
      float trainWidth=width*2.8+wakeAge*.0015;
      float trainVariance=trainWidth*trainWidth+aa*aa;
      float train=exp(-side*side/trainVariance)*exp(-wakeAge/.46)*.23;
      float endFade=1.0-smoothstep(shape.y*.55,shape.y,wakeAge);
      vec3 fresh=mix(tint,vec3(.93,.97,1.0),exp(-wakeAge*14.0));
      light+=(fresh*core*2.8+tint*train)*depositedLight*endFade*shape.w;
    }

    if(age>=0.0&&age<flight){
      float life=age/flight;
      float headAngle=life*shape.x;
      float headDistance=(along-headAngle)*(along-headAngle)+across*across;
      float headWidth=width*2.0;
      float headVariance=headWidth*headWidth+aa*aa;
      float head=exp(-headDistance/headVariance)*headWidth/sqrt(headVariance);
      float halo=exp(-headDistance/(width*width*75.0+aa*aa))*.16;
      float burn=smoothstep(0.0,.07,life)*(1.0-smoothstep(.78,1.0,life));
      float flare=1.0+.42*exp(-pow((life-.73)/.10,2.0));
      vec3 headColor=mix(vec3(.88,.96,1.0),vec3(1.0,.83,.70),smoothstep(.6,.92,life)*.38);
      light+=(headColor*head*4.5+tint*halo)*burn*flare*shape.w;
    }
  }
  return light;
}

vec3 sky(vec3 d,bool reflected){
  float y=max(d.y,0.0);
  vec3 deep=vec3(.012,.016,.068);
  vec3 horizon=vec3(.19,.16,.36);
  vec3 col=mix(horizon,deep,smoothstep(0.0,.8,y));

  // Advect all nebula frequencies together: the gas travels past fixed stars,
  // while broad, slow currents curl its edges without boiling the fine detail.
  float cloudTime=uTime-12.0;
  float angle=cloudTime*.018;
  vec3 cloudDirection=vec3(d.x*cos(angle)-d.z*sin(angle),d.y,d.x*sin(angle)+d.z*cos(angle));
  vec3 current=vec3(
    sin(cloudTime*.13+cloudDirection.y*3.0+cloudDirection.z*2.0),
    sin(cloudTime*.11+cloudDirection.x*3.0),
    cos(cloudTime*.09+cloudDirection.y*4.0+cloudDirection.x*2.0));
  vec3 p=cloudDirection*3.1+current*vec3(.12,.085,.10);
  float warp=fbm(p*1.25+vec3(1.0+cloudTime*.009,4.0,2.0-cloudTime*.006));
  float warp2=detailNoise(p*1.8-4.0);
  float plane=dot(cloudDirection,normalize(vec3(.48,.58,.22)));
  float band=exp(-pow((plane+(warp-.5)*.53-.085)/.32,2.0));
  vec3 q=p*2.1+vec3(warp*2.8,warp2*1.7,warp*1.6);
  float clouds=fbm(q);
  float fine=detailNoise(q*7.2+warp2*2.0);
  float micro=magnifiedDetail(q*42.0+vec3(6.7,2.4,-1.8),reflected?1200.0:600.0);
  clouds+=micro*.11;
  fine+=micro*.58;
  clouds+=(fine-.46)*.065;
  float mass=smoothstep(.25,.78,clouds)*band;
  float filaments=pow(max(0.0,1.0-abs(clouds-.49)*6.4),6.0)*band;
  float dust=smoothstep(.44,.66,fbm(q*1.15+13.4));
  float luminous=pow(fine,2.0)*mass*2.8;
  float wisps=smoothstep(.44,.63,fine)*mass;
  float colorfield=detailNoise(p*.95+vec3(-3.1,9.2,2.7));
  vec3 magenta=vec3(.77,.10,.62);
  vec3 violet=vec3(.23,.11,.68);
  vec3 cyan=vec3(.09,.62,.85);
  vec3 gas=mix(violet,magenta,smoothstep(.30,.66,colorfield));
  gas=mix(gas,cyan,smoothstep(.53,.72,warp2+.18*sin(cloudDirection.x*5.0+cloudDirection.y*3.0)));
  col+=gas*(mass*.83+filaments*.43+luminous*.62);
  col+=mix(vec3(.34,.50,.79),vec3(.72,.40,.66),colorfield)*(filaments*fine*.75+wisps*.24);
  col+=vec3(.44,.24,.71)*band*.085;
  col*=1.0-dust*mass*.78;

  // Soft ribbons nearer the horizon turn into bright, pearlescent mist.
  float ribbonY=y+.052*sin(d.x*4.0+d.z*2.0+cloudTime*.075)+.028*sin(d.z*9.0+d.x*6.0-cloudTime*.052);
  float ribbon=exp(-pow((ribbonY-.16)/.073,2.0));
  float ribbonNoise=detailNoise(cloudDirection*vec3(7.0,30.0,7.0)+vec3(0,cloudTime*.045,0));
  col+=mix(vec3(.10,.41,.66),vec3(.58,.26,.69),warp)*ribbon*(.2+ribbonNoise*.62);
  float veil=exp(-y*20.0);
  col+=vec3(.19,.29,.48)*veil*.52;
  col+=vec3(.52,.33,.62)*exp(-y*80.0)*.20;

  // Several star sizes keep the field rich without repeating a painted texture.
  vec3 stars=starLayer(d,170.0,.965)+starLayer(d,390.0,.979)*.76;
  if(!reflected)stars+=starLayer(d,750.0,.99)*.43;
  col+=stars*(.5+.5*smoothstep(.02,.35,y))*(1.0-mass*dust*.5);
  col+=meteorLight(d);
  return col;
}

void wave(in vec2 p,in float t,out float height,out vec2 derivative){
  height=0.0;derivative=vec2(0);
  vec2 warped=p+vec2(sin(p.y*.13+uTime*.08),sin(p.x*.16-uTime*.05))*.5;
  float zoomDetail=clamp(log2(max(1.0,tan(.575)/tan(uFov*.5))),0.0,4.0);
  for(int i=0;i<10;i++){
    float k=float(i);
    float detailWeight=i<6?1.0:smoothstep(k-6.0,k-5.0,zoomDetail);
    if(detailWeight<.001)break;
    float angle=k*2.399+.2;
    vec2 direction=vec2(cos(angle),sin(angle));
    float frequency=.55*pow(1.62,k);
    float amplitude=.039*pow(.53,k);
    float phase=dot(warped,direction)*frequency+uTime*(.35+k*.16)*(mod(k,2.0)*2.0-1.0);
    float attenuation=exp(-t*.0004*frequency)*detailWeight;
    height+=sin(phase)*amplitude*attenuation;
    derivative+=cos(phase)*direction*frequency*amplitude*attenuation;
  }
  for(int i=0;i<4;i++){
    float age=uTime-uRipples[i].z;
    if(age<0.0||age>9.0)continue;
    vec2 delta=p-uRipples[i].xy;
    float distance=length(delta);
    float radius=age*1.8;
    float envelope=exp(-pow((distance-radius)/1.15,2.0))*exp(-age*.34)*uRipples[i].w;
    float phase=distance*7.4-age*12.5;
    height+=sin(phase)*envelope*.07;
    derivative+=normalize(delta+vec2(.0001))*cos(phase)*envelope*.26;
  }
}

vec3 lake(vec3 eye,vec3 ray){
  float t=-eye.y/ray.y;
  vec3 pos=eye+ray*t;
  float height;vec2 slope;
  wave(pos.xz,t,height,slope);
  t=(height-eye.y)/ray.y;
  pos=eye+ray*t;
  wave(pos.xz,t,height,slope);
  vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));
  vec3 reflection=reflect(ray,normal);
  reflection.y=max(reflection.y,.003);
  reflection=normalize(reflection);
  vec3 reflected=sky(reflection,true);
  float fresnel=.53+.47*pow(1.0-max(0.0,dot(-ray,normal)),3.0);
  vec3 water=vec3(.011,.022,.058);
  vec3 col=mix(water,reflected,fresnel);

  // Directional caustic interference gives the foreground its opalescent color.
  vec2 uv=pos.xz;
  float nearFade=1.0-smoothstep(65.0,210.0,t);
  float n=detailNoise(vec3(uv.x*.29,uv.y*.55,uTime*.045));
  float interference=sin(uv.x*.62+sin(uv.y*1.15+uTime*.21)*1.4+uTime*.17);
  interference+=sin(uv.y*1.65+n*5.0-uTime*.29)*.67;
  float bright=pow(max(0.0,1.0-abs(interference)*1.5),7.0);
  float broken=smoothstep(.3,.68,n);
  float iridescence=sin(uv.x*.2+uv.y*.3+n*4.0)*.5+.5;
  vec3 iridescent=mix(vec3(.05,.39,.63),vec3(.64,.17,.49),iridescence);
  iridescent=mix(iridescent,vec3(.20,.71,.66),smoothstep(.51,.68,n)*.65);
  col+=iridescent*bright*broken*.53*nearFade;
  col+=iridescent*pow(max(0.0,slope.x*5.0+slope.y*4.0),3.0)*.1*nearFade;
  float crest=pow(clamp(.52+slope.x*5.0+slope.y*3.0,0.0,1.0),18.0);
  col+=vec3(.37,.57,.79)*crest*n*.08*nearFade;

  for(int i=0;i<4;i++){
    float age=uTime-uRipples[i].z;
    if(age<0.0||age>9.0)continue;
    float distance=length(pos.xz-uRipples[i].xy);
    float ring=exp(-pow((distance-age*1.8)/.065,2.0))*exp(-age*.5);
    col+=mix(vec3(.16,.59,.73),vec3(.53,.31,.69),age/9.0)*ring*.38*uRipples[i].w;
  }
  float mist=1.0-exp(-t*.0045);
  col=mix(col,vec3(.20,.22,.39),mist*.24);
  // A shared distant color prevents a hard stripe when the horizon rotates.
  if(t>400.0){
    vec3 horizonColor=sky(normalize(vec3(ray.x,.002,ray.z)),true);
    col=mix(col,horizonColor,smoothstep(400.0,1800.0,t));
  }
  return col;
}

void main(){
  vec2 screen=(vUv*2.0-1.0)*vec2(uResolution.x/uResolution.y,1.0);
  vec3 ray=normalize(vec3(screen*tan(uFov*.5),-1.0));
  float cp=cos(uPitch),sp=sin(uPitch),cy=cos(uYaw),sy=sin(uYaw);
  ray=vec3(ray.x,ray.y*cp-ray.z*sp,ray.y*sp+ray.z*cp);
  ray=vec3(ray.x*cy-ray.z*sy,ray.y,ray.x*sy+ray.z*cy);
  vec3 col;
  if(ray.y<-.001){col=lake(uEye,ray);}else{col=sky(ray,false);}
  // Exponential exposure retains the bright pastel light instead of clipping it.
  col=1.0-exp(-col*1.42);
  col=pow(max(col,vec3(0)),vec3(.89));
  vec2 v=vUv-.5;
  col*=1.0-.23*dot(v,v);
  col+=(hash13(vec3(gl_FragCoord.xy,fract(uTime)))-.5)/255.0;
  fragColor=vec4(col,1.0);
}`;

const particleVertex = `#version 300 es
precision highp float;
layout(location=0)in vec4 aSeed;
uniform float uTime;uniform float uYaw;uniform float uPitch;uniform float uFov;
uniform vec2 uResolution;uniform vec3 uEye;uniform float uPixelScale;
out vec3 vColor;out float vAlpha;
void main(){
  vec3 pos=aSeed.xyz;
  pos.x+=sin(uTime*.08+aSeed.w*19.0)*1.4;
  pos.y+=sin(uTime*.18+aSeed.w*6.0)*.5;
  pos.z+=sin(uTime*.06+aSeed.w*14.0)*1.1;
  vec3 d=pos-uEye;
  float cy=cos(uYaw),sy=sin(uYaw),cp=cos(uPitch),sp=sin(uPitch);
  d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);
  d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);
  float z=-d.z;
  float f=1.0/tan(uFov*.5);
  gl_Position=vec4(d.x*f/(uResolution.x/uResolution.y),d.y*f,z-.02,z);
  gl_PointSize=clamp((130.0/z+2.0)*uPixelScale,2.0,18.0);
  vAlpha=smoothstep(.0,4.0,z)*(.42+.32*sin(uTime*(.4+aSeed.w)+aSeed.w*100.0));
  vColor=mix(vec3(.46,.89,1.0),vec3(1.0,.70,.93),aSeed.w);
}`;
const particleFragment = `#version 300 es
precision highp float;
in vec3 vColor;in float vAlpha;out vec4 fragColor;
void main(){vec2 q=gl_PointCoord-.5;float r2=dot(q,q);float a=exp(-r2*35.0)*.3+exp(-r2*260.0);fragColor=vec4(vColor,a*vAlpha);}`;

const canvas = document.querySelector('#scene');
const loading = document.querySelector('#loading');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let gl;
function showError(message) {
  loading.classList.add('finished');
  document.body.classList.add('error');
  document.querySelector('#unsupported').hidden = false;
  if (message) document.querySelector('#error-message').textContent = message;
}

try {
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL 2 is unavailable.');
  initialize();
} catch (error) {
  console.error('Starsea could not start:', error);
  showError();
}

function initialize() {
  function program(vertex, fragment) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(p, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const sceneProgram = program(vertexSource, fragmentSource);
  const dustProgram = program(particleVertex, particleFragment);
  const uniformNames = ['uResolution','uTime','uYaw','uPitch','uFov','uEye','uRipples','uMeteorA','uMeteorB','uMeteorC','uMeteorD','uPixelScale'];
  function uniforms(p) { return Object.fromEntries(uniformNames.map(name=>[name,gl.getUniformLocation(p,name)])); }
  const sceneU = uniforms(sceneProgram), dustU = uniforms(dustProgram);
  const emptyVao = gl.createVertexArray();
  const dustVao = gl.createVertexArray();
  const particleCount = 120;
  const particles = new Float32Array(particleCount*4);
  let seed = 871321;
  function random(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
  for(let i=0;i<particleCount;i++){
    const angle=random()*Math.PI*2,radius=8+random()*110;
    particles[i*4]=Math.sin(angle)*radius;
    particles[i*4+1]=.35+Math.pow(random(),1.8)*12;
    particles[i*4+2]=7-Math.cos(angle)*radius;
    particles[i*4+3]=random();
  }
  gl.bindVertexArray(dustVao);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,particles,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);
  gl.bindVertexArray(emptyVao);

  let time=12,previous=0,raf=0,paused=reducedMotion.matches;
  const baseFov=1.15,baseProjection=Math.tan(baseFov/2),minZoom=.75,maxZoom=16;
  let yaw=0,pitch=.10,targetYaw=0,targetPitch=.10,fov=baseFov,targetFov=baseFov;
  const eye=new Float32Array([0,2.7,7]);
  const ripples=new Float32Array(16);
  for(let i=0;i<4;i++)ripples[i*4+2]=-100;
  const meteorCount=12;
  const meteorTimeScale=.60;
  const meteorA=new Float32Array(meteorCount*4),meteorB=new Float32Array(meteorCount*4);
  const meteorC=new Float32Array(meteorCount*4),meteorD=new Float32Array(meteorCount*4);
  const meteors=Array(meteorCount).fill(null);
  let rippleIndex=0,nextMeteor=time+1.4,shower=[];
  let quality='high',autoScale=1,frameTimes=[],lastAdapt=0,fastWindows=0;
  let immersive=false,pointer=null,dragDistance=0;
  const pointers=new Map();let pinch=null;
  let toastTimeout;
  const keys=new Set();
  const coarse=matchMedia('(pointer: coarse)').matches;
  const pauseButton=document.querySelector('#pause');
  const zoomLabel=document.querySelector('#zoom-reset');
  const zoomIn=document.querySelector('#zoom-in'),zoomOut=document.querySelector('#zoom-out');

  function zoomOf(angle){return baseProjection/Math.tan(angle/2);}
  function setZoom(zoom){
    const clamped=Math.max(minZoom,Math.min(maxZoom,zoom));
    targetFov=2*Math.atan(baseProjection/clamped);
    zoomIn.disabled=clamped>=maxZoom-.001;zoomOut.disabled=clamped<=minZoom+.001;
    requestFrame();
  }

  function toast(message){
    const node=document.querySelector('#toast');
    node.textContent=message;node.classList.add('visible');
    clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>node.classList.remove('visible'),2400);
  }
  function resize(){
    const width=innerWidth,height=innerHeight;
    const budgets=coarse?{ultra:4200000,high:2800000,auto:2200000,low:850000}:{ultra:8400000,high:5000000,auto:4200000,low:1400000};
    const ratioCap=quality==='ultra'?3:quality==='low'?1:2;
    const ratio=Math.min(devicePixelRatio||1,ratioCap,Math.sqrt(budgets[quality]/(width*height)))*(quality==='auto'?autoScale:1);
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
    requestFrame();
  }
  function requestFrame(){if(!raf&&!document.hidden)raf=requestAnimationFrame(frame);}
  function updatePause(){
    pauseButton.setAttribute('aria-label',paused?'继续动画':'暂停动画');
    pauseButton.title=paused?'继续动画':'暂停动画';
    document.querySelector('#pause-icon').innerHTML=paused?'<path d="m9 5 10 7-10 7V5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>':'<path d="M9 6v12M15 6v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  }
  function direction(azimuth,elevation){
    const c=Math.cos(elevation);return [Math.sin(azimuth)*c,Math.sin(elevation),-Math.cos(azimuth)*c];
  }
  function startMeteor(nearView=random()<.84){
    const slot=meteors.findIndex(m=>!m||(time-m.started)*meteorTimeScale>m.flight+m.afterglow);
    if(slot<0)return false;
    const cameraAzimuth=yaw+(Math.cos(pitch)<0?Math.PI:0);
    const horizontalFov=2*Math.atan(Math.tan(fov/2)*innerWidth/innerHeight);
    const side=random()<.18?-1:1;
    const azimuth=nearView?cameraAzimuth+(random()-.60)*horizontalFov*.85*side:random()*Math.PI*2;
    const cameraElevation=Math.asin(Math.abs(Math.sin(pitch)));
    const viewScale=Math.min(1.0,fov/baseFov);
    const elevation=nearView?Math.max(.055,Math.min(1.53,cameraElevation+(.10+random()*baseFov*.38)*viewScale)):.28+random()*1.05;
    const origin=direction(azimuth,elevation);
    const right=[Math.cos(azimuth),0,Math.sin(azimuth)];
    const down=[Math.sin(azimuth)*Math.sin(elevation),-Math.cos(elevation),-Math.cos(azimuth)*Math.sin(elevation)];
    const slope=.50+random()*.60;
    const tangent=right.map((v,i)=>(v*side+down[i]*slope)/Math.hypot(1,slope));
    const bright=random()<.28;
    // Follow a genuine spherical arc. Clip before the horizon rather than
    // letting the head travel underground or pop out of its reflection.
    const horizonAngle=Math.atan2(origin[1],-tangent[1]);
    const arc=Math.min((bright?.55:.30)+random()*.32,horizonAngle-.025);
    const flight=Math.max(.24,Math.min(1.05,arc/(.65+random()*.45)));
    const afterglow=bright?1.45:1.05;
    const center=origin.map((v,i)=>v*Math.cos(arc*.5)+tangent[i]*Math.sin(arc*.5));
    meteors[slot]={origin,tangent,center,arc,flight,afterglow,started:time,tint:random(),energy:bright?1.4+random()*.6:.50+random()*.55,bound:Math.cos(arc*.5+.055)};
    return true;
  }
  function triggerShower(){
    if(paused){paused=false;updatePause();previous=0;}
    shower=Array.from({length:24},(_,i)=>time+i*.17);
    toast('愿你的心愿，落在星光里。');requestFrame();
  }
  function rippleAt(x,y){
    const sx=(x/innerWidth*2-1)*(innerWidth/innerHeight)*Math.tan(fov/2);
    const sy=(1-y/innerHeight*2)*Math.tan(fov/2);
    let rx=sx,ry=sy*Math.cos(pitch)+Math.sin(pitch),rz=sy*Math.sin(pitch)-Math.cos(pitch);
    const tx=rx*Math.cos(yaw)-rz*Math.sin(yaw);
    rz=rx*Math.sin(yaw)+rz*Math.cos(yaw);rx=tx;
    if(ry>=-.016)return;
    const distance=-eye[1]/ry;
    if(distance>170)return;
    const i=(rippleIndex++%4)*4;
    ripples[i]=eye[0]+rx*distance;ripples[i+1]=eye[2]+rz*distance;ripples[i+2]=time;ripples[i+3]=1;
    if(paused){time+=.12;}requestFrame();
  }
  async function setImmersive(next){
    immersive=next;document.body.classList.toggle('immersive',next);
    document.querySelectorAll('.chrome').forEach(node=>{node.inert=next;});
    document.querySelector('#immerse').setAttribute('aria-label',next?'退出沉浸模式':'进入沉浸模式');
    if(next){document.querySelector('#leave-immersive').focus({preventScroll:true});if(document.documentElement.requestFullscreen&&!document.fullscreenElement){try{await document.documentElement.requestFullscreen();}catch{}}}
    else {if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}document.querySelector('#immerse').focus({preventScroll:true});}
  }
  canvas.addEventListener('pointerdown',e=>{
    if(pointers.size>=2)return;
    const tracked={id:e.pointerId,x:e.clientX,y:e.clientY};pointers.set(e.pointerId,tracked);
    canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});
    if(pointers.size===1){pointer=tracked;dragDistance=0;pinch=null;}
    else{
      const [a,b]=[...pointers.values()];
      pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:zoomOf(targetFov)};
      pointer=null;dragDistance=Infinity;
    }
  });
  canvas.addEventListener('pointermove',e=>{
    const tracked=pointers.get(e.pointerId);if(!tracked)return;
    const dx=e.clientX-tracked.x,dy=e.clientY-tracked.y;
    tracked.x=e.clientX;tracked.y=e.clientY;
    if(pinch&&pointers.size===2){
      const [a,b]=[...pointers.values()];
      setZoom(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance);return;
    }
    if(!pointer)return;
    dragDistance+=Math.abs(dx)+Math.abs(dy);
    const sensitivity=Math.PI*2/(coarse?innerWidth*2.2:Math.max(1400,innerWidth*1.2))/zoomOf(fov);
    targetYaw-=dx*sensitivity;targetPitch+=dy*sensitivity;
    requestFrame();
  });
  function endPointer(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    if(!cancelled&&pointers.size===1&&!pinch&&dragDistance<8)rippleAt(e.clientX,e.clientY);
    pointers.delete(e.pointerId);pinch=null;
    pointer=pointers.size?[...pointers.values()][0]:null;
    dragDistance=Infinity;requestFrame();
  }
  canvas.addEventListener('pointerup',e=>endPointer(e));
  canvas.addEventListener('pointercancel',e=>endPointer(e,true));
  canvas.addEventListener('lostpointercapture',e=>endPointer(e,true));
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);
    setZoom(zoomOf(targetFov)*Math.exp(-Math.max(-1200,Math.min(1200,delta))*.0015));
  },{passive:false});
  canvas.addEventListener('keydown',e=>{
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D'].includes(e.key)){e.preventDefault();keys.add(e.key.toLowerCase());requestFrame();}
    if(e.code==='Space'){e.preventDefault();paused=!paused;previous=0;updatePause();requestFrame();}
    if(e.key==='Home'){e.preventDefault();resetView();}
    if(!e.ctrlKey&&!e.metaKey&&['+','=','-','_'].includes(e.key)){
      e.preventDefault();setZoom(zoomOf(targetFov)*(['+','='].includes(e.key)?Math.SQRT2:1/Math.SQRT2));
    }
  });
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>{keys.clear();pointer=null;pointers.clear();pinch=null;});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&immersive)setImmersive(false);});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&immersive){immersive=false;document.body.classList.remove('immersive');document.querySelectorAll('.chrome').forEach(node=>{node.inert=false;});}resize();});
  pauseButton.addEventListener('click',()=>{paused=!paused;previous=0;updatePause();requestFrame();});
  document.querySelector('#meteor').addEventListener('click',triggerShower);
  document.querySelector('#immerse').addEventListener('click',()=>setImmersive(!immersive));
  document.querySelector('#leave-immersive').addEventListener('click',()=>setImmersive(false));
  function resetView(){
    const tau=Math.PI*2;
    targetYaw=Math.round(yaw/tau)*tau;targetPitch=.10+Math.round((pitch-.10)/tau)*tau;setZoom(1);
    requestFrame();
  }
  document.querySelector('#reset-view').addEventListener('click',resetView);
  zoomIn.addEventListener('click',()=>setZoom(zoomOf(targetFov)*Math.SQRT2));
  zoomOut.addEventListener('click',()=>setZoom(zoomOf(targetFov)/Math.SQRT2));
  zoomLabel.addEventListener('click',()=>setZoom(1));
  document.querySelector('#quality').addEventListener('change',e=>{quality=e.target.value;autoScale=1;frameTimes=[];fastWindows=0;lastAdapt=performance.now();resize();});
  window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{previous=0;frameTimes=[];if(document.hidden){cancelAnimationFrame(raf);raf=0;keys.clear();}else requestFrame();});
  reducedMotion.addEventListener('change',e=>{paused=e.matches;previous=0;updatePause();requestFrame();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(raf);raf=0;showError('画面暂时中断。重新进入，就能再次回到星海。');});

  function setCommon(u){
    gl.uniform2f(u.uResolution,canvas.width,canvas.height);
    gl.uniform1f(u.uTime,time);gl.uniform1f(u.uYaw,yaw);gl.uniform1f(u.uPitch,pitch);gl.uniform1f(u.uFov,fov);
    gl.uniform3fv(u.uEye,eye);
  }
  function frame(now){
    raf=0;
    const rawDt=previous?(now-previous)/1000:1/60;
    const dt=Math.min(rawDt,.05);previous=now;
    // Keep sky and meteor speed tied to elapsed time even on slower GPUs.
    // Camera input keeps its small timestep; tab visibility resets the clock.
    if(!paused){time+=Math.min(rawDt,.25);}
    const rotationScale=1/zoomOf(fov);
    if(keys.has('arrowleft')||keys.has('a'))targetYaw+=dt*.70*rotationScale;
    if(keys.has('arrowright')||keys.has('d'))targetYaw-=dt*.70*rotationScale;
    if(keys.has('arrowup')||keys.has('w'))targetPitch+=dt*.65*rotationScale;
    if(keys.has('arrowdown')||keys.has('s'))targetPitch-=dt*.65*rotationScale;
    const damping=1-Math.exp(-dt*8);
    yaw+=(targetYaw-yaw)*damping;pitch+=(targetPitch-pitch)*damping;fov+=(targetFov-fov)*damping;
    const zoomText=zoomOf(fov).toFixed(1)+'×';
    if(zoomLabel.textContent!==zoomText)zoomLabel.textContent=zoomText;
    const tau=Math.PI*2;
    if(Math.abs(yaw)>tau*4){const offset=Math.trunc(yaw/tau)*tau;yaw-=offset;targetYaw-=offset;}
    if(Math.abs(pitch)>tau*4){const offset=Math.trunc(pitch/tau)*tau;pitch-=offset;targetPitch-=offset;}
    if(!paused){
      if(time>nextMeteor){startMeteor();nextMeteor=time+.9+random()*1.3;}
      while(shower.length&&time>=shower[0]){if(!startMeteor(true))break;shower.shift();}
    }
    meteorA.fill(0);meteorB.fill(0);meteorC.fill(0);meteorD.fill(0);
    for(let i=0;i<meteorCount;i++){
      const m=meteors[i];if(!m)continue;
      // Slow the entire meteor lifecycle together to retain the tapered wake.
      const age=(time-m.started)*meteorTimeScale;
      if(age>m.flight+m.afterglow){meteors[i]=null;continue;}
      meteorA.set([...m.origin,age],i*4);meteorB.set([...m.tangent,m.flight],i*4);
      meteorC.set([m.arc,m.afterglow,m.tint,m.energy],i*4);meteorD.set([...m.center,m.bound],i*4);
    }
    gl.disable(gl.BLEND);gl.useProgram(sceneProgram);gl.bindVertexArray(emptyVao);setCommon(sceneU);
    gl.uniform4fv(sceneU.uRipples,ripples);gl.uniform4fv(sceneU.uMeteorA,meteorA);gl.uniform4fv(sceneU.uMeteorB,meteorB);
    gl.uniform4fv(sceneU.uMeteorC,meteorC);gl.uniform4fv(sceneU.uMeteorD,meteorD);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    gl.useProgram(dustProgram);gl.bindVertexArray(dustVao);setCommon(dustU);
    gl.uniform1f(dustU.uPixelScale,canvas.height/innerHeight);
    gl.drawArrays(gl.POINTS,0,particleCount);gl.disable(gl.BLEND);
    if(!loading.classList.contains('finished')){loading.classList.add('finished');setTimeout(()=>loading.remove(),1400);}
    if(!paused&&quality==='auto'&&now-lastAdapt>4500){
      if(frameTimes.length>30){
        const sorted=frameTimes.slice().sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
        if(median>.043&&autoScale>.78){autoScale=Math.max(.78,autoScale*.9);fastWindows=0;resize();}
        else if(median<.021&&autoScale<1){if(++fastWindows>=2){autoScale=Math.min(1,autoScale/.9);fastWindows=0;resize();}}
        else fastWindows=0;
      }
      lastAdapt=now;frameTimes=[];
    }
    if(!paused&&rawDt<.3)frameTimes.push(rawDt);
    if(frameTimes.length>160)frameTimes.shift();
    const moving=Math.abs(targetYaw-yaw)+Math.abs(targetPitch-pitch)+Math.abs(targetFov-fov)>.0001;
    if(!paused||moving||keys.size)requestFrame();
  }
  startMeteor(true);meteors[0].started-=.18;
  updatePause();resize();requestFrame();
  setTimeout(()=>{const hint=document.querySelector('#hint');if(hint)hint.style.opacity='.25';},16000);
}
