(function(host,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.WMFeatureViewport=api.create(host);})(globalThis,function(){
 function create(host){const callbacks=new Map();let frame=0,active=false;
  const run=()=>{frame=0;for(const callback of callbacks.values())callback();};
  const schedule=()=>{if(!frame)frame=host.requestAnimationFrame(run);};
  function mount(key,callback){if(!key||typeof callback!=='function')throw Error('UI feature key and callback required');callbacks.set(key,callback);
   if(!active){host.addEventListener('resize',schedule);host.addEventListener('orientationchange',schedule);active=true;}
   return()=>{if(callbacks.get(key)!==callback)return;callbacks.delete(key);if(!callbacks.size){host.removeEventListener('resize',schedule);host.removeEventListener('orientationchange',schedule);active=false;if(frame){host.cancelAnimationFrame(frame);frame=0;}}};
  }
  return {mount};
 }
 return {create};
});
