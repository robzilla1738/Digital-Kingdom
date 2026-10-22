import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { CastleModule } from './src/castle/modules.tsx';
import type { ModuleId } from '@dk/contracts';
const ids:ModuleId[]=['gatehouse','guardhouse','hall','great_hall','workshop','vault','observatory','tool_annex','forge','portal'];
createRoot(document.getElementById('root')!).render(<>
<style>{`*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;font-family:Arial,sans-serif;background:#101419;color:#e1e6ed}header{height:90px;padding:20px 26px}h1{font-size:24px;font-weight:600;margin:0 0 8px}p{margin:0;color:#a3afbd;font-size:13px}.grid{display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(2,390px);gap:10px;padding:0 18px}.card{background:#151c24;border:1px solid #2a3541;border-radius:8px;overflow:hidden;position:relative}.view{height:348px}h2{font-size:14px;line-height:40px;font-weight:500;text-align:center;margin:0;border-top:1px solid #2a3541}`}</style>
<header><h1>Digital Kingdom · baseline module study</h1><p>Exact baseline procedural geometry · neutral study lighting · roofs visible · synthetic visual study, not security evidence</p></header>
<div className="grid">{ids.map(id=><section className="card" key={id}><div className="view"><Canvas shadows dpr={1} orthographic camera={{position:[8,7,10],zoom:31,near:0.1,far:100}} gl={{antialias:true}} onCreated={({camera})=>camera.lookAt(0,1.6,0)}><color attach="background" args={['#151c24']}/><ambientLight intensity={1}/><directionalLight position={[5,9,8]} intensity={2.2} castShadow shadow-mapSize={[512,512]}/><directionalLight position={[-6,3,-4]} intensity={0.6}/><CastleModule id={id} roofs={true}/><mesh rotation={[-Math.PI/2,0,0]} receiveShadow position={[0,-0.02,0]}><planeGeometry args={[16,16]}/><meshStandardMaterial color="#202a35" roughness={1}/></mesh></Canvas></div><h2>{id}</h2></section>)}</div>
</>);
