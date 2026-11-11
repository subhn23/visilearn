import type { Entity, Scene } from '../../../core/types.ts';
import type { Packet } from '../sim.ts';

const INFRA = new Set(['fw', 'switch', 'router']);

/** Devices a learner can send packets between (not the boxes in the middle). */
export function labEndpoints(scene: Scene): Entity[] {
  return scene.entities.filter((e) => e.pack === 'net' && !INFRA.has(e.kind));
}

export interface LabInput {
  from: string;
  to: string;
  proto: 'tcp' | 'udp' | 'icmp';
  port: string;
}

export function buildPacket(i: LabInput): { packet?: Packet; error?: string } {
  if (i.from === i.to) return { error: 'Pick two different devices.' };
  if (i.proto === 'icmp') return { packet: { src: i.from, dst: i.to, proto: 'icmp', port: null } };
  const port = /^\d+$/.test(i.port.trim()) ? parseInt(i.port, 10) : NaN;
  if (!(port >= 1 && port <= 65535)) return { error: 'Port must be a number 1-65535.' };
  return { packet: { src: i.from, dst: i.to, proto: i.proto, port } };
}
