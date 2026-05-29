import React, { useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useAnimations, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { setLipsyncCallback, getAudioVolumeAnalyser } from './voiceService';

// Standard GLB RPM/Mixamo Morph Targets
const rhubarbToMorphTarget = {
  'A': 'viseme_PP',
  'B': 'viseme_kk',
  'C': 'viseme_I',
  'D': 'viseme_AA',
  'E': 'viseme_O',
  'F': 'viseme_U',
  'G': 'viseme_FF',
  'H': 'viseme_TH',
  'X': 'viseme_PP' // closed
};

// VRM Expression Mapping
const rhubarbToVRM = {
  'A': 'aa',     // Open mouth, large
  'B': 'ee',     // Tense mouth
  'C': 'ih',     // E / I
  'D': 'aa',     // A
  'E': 'oh',     // O
  'F': 'ou',     // U
  'G': 'aa',     // F/V (wide)
  'H': 'ou',     // TH
  'X': 'neutral' // Closed
};

export function Avatar({ isSpeaking, avatarUrl, avatarExt, gesture = 'idle', customGestures = {}, editingBone, onGizmoDragStart, onGizmoDragEnd, onBoneRotate, ...props }) {
  const group = useRef();
  
  // Conditionally load VRM or standard GLTF
  const gltf = useLoader(GLTFLoader, avatarUrl, (loader) => {
    if (avatarExt === 'vrm') {
      loader.register((parser) => new VRMLoaderPlugin(parser));
    }
  });

  const { scene, animations } = gltf;
  const vrm = gltf.userData.vrm; // Will be defined if it's a VRM file
  const { actions } = useAnimations(animations, group);
  
  const [mouthCues, setMouthCues] = useState([]);
  const audioRef = useRef(null);

  // Bind the global lipsync callback
  useEffect(() => {
    setLipsyncCallback((cues, audioNode) => {
      setMouthCues(cues?.mouthCues || []);
      audioRef.current = audioNode;
    });
    
    return () => setLipsyncCallback(null);
  }, []);

  // Standard GLB Idle Animation Setup
  useEffect(() => {
    if (!vrm && actions && Object.keys(actions).length > 0) {
      const idleAction = Object.values(actions)[0];
      idleAction.play();
    }
  }, [actions, vrm]);
  
  // Rotate VRM models to face the camera (typically they face +Z instead of -Z)
  useEffect(() => {
    if (vrm) {
      scene.rotation.y = Math.PI; 
    } else {
      scene.rotation.y = 0;
    }
  }, [vrm, scene]);

  useFrame((state, delta) => {
    // Cap delta to prevent chaotic lerp overshooting when tab regains focus
    delta = Math.min(delta, 0.1);
    
    let currentCue = null;
    
    if (isSpeaking && audioRef.current && mouthCues.length > 0) {
      const currentAudioTime = audioRef.current.currentTime;
      currentCue = mouthCues.find(
        (cue) => currentAudioTime >= cue.start && currentAudioTime <= cue.end
      );
    }
    
    if (vrm) {
      // 1. VRM EXPRESSION LOGIC
      // Reset all lipsync expressions
      ['aa', 'ee', 'ih', 'oh', 'ou', 'neutral'].forEach(exp => {
        vrm.expressionManager.setValue(exp, 0);
      });
      
      if (isSpeaking) {
        if (currentCue) {
          const vrmExpr = rhubarbToVRM[currentCue.value];
          if (vrmExpr) {
            vrm.expressionManager.setValue(vrmExpr, 1);
          } else {
            vrm.expressionManager.setValue('neutral', 1);
          }
        } else {
          // Fallback: Real-time Volume-based Lip-Sync (Option 1)
          const analyser = getAudioVolumeAnalyser();
          let volume = 0;
          if (analyser) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const floatVal = (dataArray[i] - 128) / 128;
              sum += floatVal * floatVal;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            volume = Math.min(1.0, rms * 5.0); // Boost sensitivity slightly
          } else {
            // Procedural backup if analyser is not loaded or suspended
            volume = Math.max(0, (Math.sin(state.clock.elapsedTime * 10) * 0.4 + Math.sin(state.clock.elapsedTime * 17) * 0.3 + 0.4));
          }
          vrm.expressionManager.setValue('aa', volume);
        }
      } else {
        // Idle closed mouth
        vrm.expressionManager.setValue('neutral', 1);
        // Add some random blinking when idle
        const blinkAmount = Math.sin(state.clock.elapsedTime * 4) > 0.95 ? 1 : 0;
        vrm.expressionManager.setValue('blink', blinkAmount);
      }

      // 2. GESTURES & IDLE ANIMATION
      const defaultGestures = {
        idle: {
          leftUpperArm: { x: 0, y: 0, z: 1.2 },
          rightUpperArm: { x: 0, y: 0, z: -1.2 },
          leftLowerArm: { x: 0, y: 0, z: 0 },
          rightLowerArm: { x: 0, y: 0, z: 0 },
        },
        greeting: {
          leftUpperArm: { x: 0, y: 0, z: 1.2 },
          rightUpperArm: { x: 0, y: 0, z: -1.2 }, 
          leftLowerArm: { x: 0, y: 0, z: 0 },
          rightLowerArm: { x: 0, y: 0, z: 0 }, 
        },
        thinking: {
          leftUpperArm: { x: 0, y: 0, z: 1.2 },
          rightUpperArm: { x: 0, y: 0, z: -1.2 },
          leftLowerArm: { x: 0, y: 0, z: 0 },
          rightLowerArm: { x: 0, y: 0, z: 0 },
        }
      };
      
      const mergedGestures = {
        idle: { ...defaultGestures.idle, ...(customGestures.idle || {}) },
        greeting: { ...defaultGestures.greeting, ...(customGestures.greeting || {}) },
        thinking: { ...defaultGestures.thinking, ...(customGestures.thinking || {}) }
      };

      const targetPose = mergedGestures[gesture] || mergedGestures.idle;
      
      const time = state.clock.elapsedTime;
      
      // Calculate dynamic procedural arm offsets for body language
      let armOffsets = {
        leftUpperArm: {x:0, y:0, z:0},
        rightUpperArm: {x:0, y:0, z:0},
        leftLowerArm: {x:0, y:0, z:0},
        rightLowerArm: {x:0, y:0, z:0}
      };

      if (isSpeaking) {
        // Gently wave arms when speaking
        armOffsets.leftUpperArm.z = Math.sin(time * 3.1) * 0.08;
        armOffsets.rightUpperArm.z = -(Math.sin(time * 2.8) * 0.08);
        
        armOffsets.leftLowerArm.x = Math.sin(time * 4.5) * 0.15;
        armOffsets.leftLowerArm.y = Math.sin(time * 3.2) * 0.1;
        
        armOffsets.rightLowerArm.x = Math.sin(time * 4.2) * 0.15;
        armOffsets.rightLowerArm.y = -(Math.sin(time * 3.5) * 0.1);
      }

      const applyBone = (boneName, targetRot, offsets = {x:0,y:0,z:0}) => {
        if (!targetRot || boneName === editingBone) return;
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
        if (bone) {
          // Smooth interpolation towards target pose + offsets
          if (targetRot.x !== undefined) bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, targetRot.x + (offsets.x || 0), 5 * delta);
          if (targetRot.y !== undefined) bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, targetRot.y + (offsets.y || 0), 5 * delta);
          if (targetRot.z !== undefined) bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, targetRot.z + (offsets.z || 0), 5 * delta);
        }
      };
      
      applyBone('leftUpperArm', targetPose.leftUpperArm, armOffsets.leftUpperArm);
      applyBone('rightUpperArm', targetPose.rightUpperArm, armOffsets.rightUpperArm);
      applyBone('leftLowerArm', targetPose.leftLowerArm, armOffsets.leftLowerArm);
      applyBone('rightLowerArm', targetPose.rightLowerArm, armOffsets.rightLowerArm);
      
      // 3. FULL BODY LANGUAGE & BREATHING
      
      // Breathing: Chest and spine expand/contract slightly
      const chest = vrm.humanoid.getNormalizedBoneNode('chest');
      if (chest) chest.rotation.x = Math.sin(time * 1.5) * 0.02;
      
      const spine = vrm.humanoid.getNormalizedBoneNode('spine');
      if (spine) spine.rotation.x = Math.sin(time * 1.5 + 0.5) * 0.01;

      // Head & Neck drift
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const neck = vrm.humanoid.getNormalizedBoneNode('neck');
      if (head && neck) {
        if (!isSpeaking) {
          // Slow drift when idle
          head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, Math.sin(time * 0.5) * Math.cos(time * 0.3) * 0.15, 2 * delta);
          head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, Math.sin(time * 0.7) * 0.05, 2 * delta);
        } else {
           // Focus forward but bob head slightly to punctuate speech
           head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, 0, 5 * delta);
           head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, Math.sin(time * 4.0) * 0.03, 5 * delta);
        }
      }
      
      // Hands twitching/moving slightly when speaking
      const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
      const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
      if (isSpeaking) {
        if (leftHand) leftHand.rotation.x = THREE.MathUtils.lerp(leftHand.rotation.x, Math.sin(time * 6) * 0.1, 5 * delta);
        if (rightHand) rightHand.rotation.x = THREE.MathUtils.lerp(rightHand.rotation.x, Math.sin(time * 6.5) * 0.1, 5 * delta);
      } else {
        if (leftHand) leftHand.rotation.x = THREE.MathUtils.lerp(leftHand.rotation.x, 0, 5 * delta);
        if (rightHand) rightHand.rotation.x = THREE.MathUtils.lerp(rightHand.rotation.x, 0, 5 * delta);
      }

      // Crucial: Update the VRM instance to apply expressions and physics
      vrm.update(delta);
      
    } else {
      // 3. STANDARD GLB MORPH TARGET LOGIC
      scene.traverse((child) => {
        if (child.isMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
          // Zero out all rhubarb morph targets
          Object.values(rhubarbToMorphTarget).forEach((target) => {
            const index = child.morphTargetDictionary[target];
            if (index !== undefined) {
              child.morphTargetInfluences[index] = THREE.MathUtils.lerp(
                child.morphTargetInfluences[index],
                0,
                0.2
              );
            }
          });

          // Apply current morph target
          if (isSpeaking) {
            if (currentCue) {
              const target = rhubarbToMorphTarget[currentCue.value];
              if (target) {
                const index = child.morphTargetDictionary[target];
                if (index !== undefined) {
                  child.morphTargetInfluences[index] = THREE.MathUtils.lerp(
                    child.morphTargetInfluences[index],
                    1,
                    0.3
                  );
                }
              }
            } else {
              // Fallback: Volume-based morph targets for standard GLB models
              const analyser = getAudioVolumeAnalyser();
              let volume = 0;
              if (analyser) {
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteTimeDomainData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                  const floatVal = (dataArray[i] - 128) / 128;
                  sum += floatVal * floatVal;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                volume = Math.min(1.0, rms * 5.0);
              } else {
                volume = Math.max(0, (Math.sin(state.clock.elapsedTime * 10) * 0.4 + Math.sin(state.clock.elapsedTime * 17) * 0.3 + 0.4));
              }
              const index = child.morphTargetDictionary['viseme_AA'];
              if (index !== undefined) {
                child.morphTargetInfluences[index] = THREE.MathUtils.lerp(
                  child.morphTargetInfluences[index],
                  volume,
                  0.3
                );
              }
            }
          }
        }
      });
    }
  });

  return (
    <group ref={group} {...props} dispose={null}>
      <primitive object={scene} />
      {vrm && editingBone && vrm.humanoid.getNormalizedBoneNode(editingBone) && (
        <TransformControls 
           object={vrm.humanoid.getNormalizedBoneNode(editingBone)}
           mode="rotate"
           onMouseDown={onGizmoDragStart}
           onMouseUp={onGizmoDragEnd}
           onChange={() => {
              const bone = vrm.humanoid.getNormalizedBoneNode(editingBone);
              if (bone && onBoneRotate) {
                 onBoneRotate(editingBone, { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z });
              }
           }}
           size={0.5}
        />
      )}
    </group>
  );
}
