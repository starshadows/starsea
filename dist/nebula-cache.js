// Cache completed cloud radiance, rather than individual noise evaluations.
// All textures are generated locally; there are no image downloads or services.
export function createNebulaCache(gl,vertexSource,fragmentSource,makeProgram,options={}){
  let bakeProgram=null,framebuffer=null,vao=null,cube=null,patch=null;
  try{
  bakeProgram=makeProgram(vertexSource,fragmentSource.replace('#version 300 es','#version 300 es\n#define BAKE_NEBULA'));
  const names=['uTime','uCloudRotation','uProjection','uBakeFace','uBakePatch','uCacheEncoded','uPatchForward','uPatchRight','uPatchUp','uPatchScale'];
  const u=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(bakeProgram,name)]));
  framebuffer=gl.createFramebuffer();vao=gl.createVertexArray();
  const maxSize=Math.min(gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const floatColor=!options.forceRGBA8&&!!gl.getExtension('EXT_color_buffer_float');
  let size=0,encoded=0;
  const requested=Math.min(options.size||1024,maxSize);
  function textureParameters(target){
    gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(target===gl.TEXTURE_CUBE_MAP)gl.texParameteri(target,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  }
  function releaseTextures(){if(cube)gl.deleteTexture(cube);if(patch)gl.deleteTexture(patch);cube=patch=null;}
  function allocate(candidate,useFloat){
    const format=useFloat?gl.RGBA16F:gl.RGBA8;
    releaseTextures();size=candidate;encoded=useFloat?0:1;
    cube=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_CUBE_MAP,cube);
    textureParameters(gl.TEXTURE_CUBE_MAP);gl.texStorage2D(gl.TEXTURE_CUBE_MAP,1,format,size,size);
    patch=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,patch);
    textureParameters(gl.TEXTURE_2D);gl.texStorage2D(gl.TEXTURE_2D,1,format,size,size);
    if(gl.getError()!==gl.NO_ERROR)return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X,cube,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)return false;
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,patch,0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
  }
  let allocated=false;
  for(const candidate of [...new Set([requested,Math.min(512,requested),Math.min(256,requested)])]){
    if(candidate<1||gl.isContextLost())break;
    for(const useFloat of floatColor?[true,false]:[false]){
      if(allocate(candidate,useFloat)){allocated=true;break;}
    }
    if(allocated)break;
  }
  if(!allocated){
    releaseTextures();gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);gl.deleteProgram(bakeProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);return null;
  }
  function beginBake(){
    gl.useProgram(bakeProgram);gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.viewport(0,0,size,size);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(u.uTime,12);gl.uniform2f(u.uCloudRotation,1,0);gl.uniform1f(u.uCacheEncoded,encoded);
  }
  beginBake();gl.uniform1i(u.uBakePatch,0);gl.uniform4f(u.uProjection,1,2/size,0,1);
  for(let face=0;face<6;face++){
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,cube,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      releaseTextures();gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);gl.deleteProgram(bakeProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);return null;
    }
    gl.uniform1i(u.uBakeFace,face);gl.drawArrays(gl.TRIANGLES,0,3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  const stats={size,format:encoded?'RGBA8 encoded':'RGBA16F',bytes:size*size*7*(encoded?4:8),cubeRenders:6,patchRenders:0};
  let available=false,patchDetail=0;
  let forward=[0,0,-1],right=[1,0,0],up=[0,1,0],scale=[1,1];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const unit=a=>{const length=Math.hypot(...a);return a.map(v=>v/length);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function cloudDirection(d,time){
    const t=time-12,c=Math.cos(t*.018),s=Math.sin(t*.018);
    const r=[d[0]*c-d[2]*s,d[1],d[0]*s+d[2]*c];
    const phase=[r[1]*3+r[2]*2,r[0]*3,r[1]*4+r[0]*2];
    const delta=[(Math.sin(phase[0]+t*.13)-Math.sin(phase[0]))*.12/3.1,(Math.sin(phase[1]+t*.11)-Math.sin(phase[1]))*.085/3.1,(Math.cos(phase[2]+t*.09)-Math.cos(phase[2]))*.10/3.1];
    const normal=dot(r,delta);
    return unit(r.map((v,i)=>v+delta[i]-v*normal));
  }
  function update({yaw,pitch,fov,aspect,time,zoomDetail}){
    if(zoomDetail<.8){available=false;return;}
    // Mirror the viewing direction across a flat lake to cover both the sky
    // and the main reflected field. Real per-pixel wave reflection stays live.
    const center=cloudDirection([Math.sin(yaw)*Math.cos(pitch),Math.abs(Math.sin(pitch)),-Math.cos(yaw)*Math.cos(pitch)],time);
    const tan=Math.tan(fov*.5),newScale=[Math.max(.025,tan*aspect*1.65),Math.max(.025,tan*1.65)];
    // At the poles the camera can roll around a near-fixed center. A square
    // angular patch keeps portrait and landscape views covered at any roll.
    if(Math.abs(center[1])>.94)newScale.fill(Math.max(...newScale));
    const distance=dot(center,forward);
    const outside=distance<=0||Math.max(Math.abs(dot(center,right)/Math.max(distance,.001)/scale[0]),Math.abs(dot(center,up)/Math.max(distance,.001)/scale[1]))>.23;
    const resized=newScale.some((value,i)=>value/scale[i]<.78||value/scale[i]>1.15);
    if(available&&!outside&&!resized&&Math.abs(zoomDetail-patchDetail)<.35)return;
    forward=center;right=unit(cross(forward,Math.abs(forward[1])>.96?[0,0,1]:[0,1,0]));up=cross(right,forward);
    scale=newScale;patchDetail=zoomDetail;
    beginBake();gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,patch,0);
    gl.uniform1i(u.uBakePatch,1);gl.uniform3fv(u.uPatchForward,forward);gl.uniform3fv(u.uPatchRight,right);gl.uniform3fv(u.uPatchUp,up);
    gl.uniform2fv(u.uPatchScale,scale);gl.uniform4f(u.uProjection,tan,2*scale[1]/size,zoomDetail,aspect);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    available=true;stats.patchRenders++;
  }
  function bind(locations){
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_CUBE_MAP,cube);gl.uniform1i(locations.uNebulaCube,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,patch);gl.uniform1i(locations.uNebulaPatch,1);
    gl.uniform1f(locations.uCacheEncoded,encoded);gl.uniform1f(locations.uPatchAvailable,available?1:0);
    gl.uniform3fv(locations.uPatchForward,forward);gl.uniform3fv(locations.uPatchRight,right);gl.uniform3fv(locations.uPatchUp,up);gl.uniform2fv(locations.uPatchScale,scale);
  }
  return {size,stats,update,bind,dispose(){releaseTextures();gl.deleteProgram(bakeProgram);gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);}};
  }catch(error){
    if(cube)gl.deleteTexture(cube);if(patch)gl.deleteTexture(patch);
    if(bakeProgram)gl.deleteProgram(bakeProgram);if(framebuffer)gl.deleteFramebuffer(framebuffer);if(vao)gl.deleteVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    console.warn('Nebula cache unavailable; using the procedural renderer.',error);
    return null;
  }
}
