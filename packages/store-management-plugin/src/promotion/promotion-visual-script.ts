import { createHash } from 'node:crypto';

const VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const FRAGMENT_SHADER_SOURCE = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform vec2 u_pointer;
    uniform float u_time;
    uniform float u_energy;

    const float PI = 3.14159265359;

    mat2 rotate2d(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c);
    }

    float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }

    float mask(float distanceValue, float width) {
        return 1.0 - smoothstep(0.0, width, distanceValue);
    }

    float ringMask(vec2 p, float angle, float flatten, float radius, float width) {
        vec2 q = rotate2d(angle) * p;
        q.y /= flatten;
        float distanceToRing = abs(length(q) - radius);
        return mask(distanceToRing, width);
    }

    float boxLine(vec2 p, vec2 bounds, float width) {
        vec2 d = abs(p) - bounds;
        float outside = length(max(d, 0.0));
        float inside = min(max(d.x, d.y), 0.0);
        float signedDistance = outside + inside;
        return mask(abs(signedDistance), width);
    }

    float segmentMask(vec2 p, vec2 start, vec2 end, float width) {
        vec2 pointVector = p - start;
        vec2 segmentVector = end - start;
        float projection = clamp(
            dot(pointVector, segmentVector) / max(dot(segmentVector, segmentVector), 0.0001),
            0.0,
            1.0
        );
        return mask(length(pointVector - segmentVector * projection), width);
    }

    vec4 renderOrbit(
        vec2 p,
        float angle,
        float flatten,
        float radius,
        float width,
        float phase,
        vec3 tint
    ) {
        vec2 q = rotate2d(angle) * p;
        q.y /= flatten;
        float orbitRadius = length(q);
        float distanceToRing = abs(orbitRadius - radius);
        float tube = mask(distanceToRing, width * 1.35);
        float core = mask(distanceToRing, width * 0.25);
        float innerEdge = mask(abs(distanceToRing - width * 0.8), width * 0.15);
        float outerEdge = mask(abs(distanceToRing - width * 1.14), width * 0.12);
        float halo = mask(distanceToRing, width * 5.2);
        float angleOnRing = atan(q.y, q.x);
        float nearSide = 0.38 + 0.62 * smoothstep(-0.88, 0.74, sin(angleOnRing + phase));
        float dataPulse = pow(max(0.0, cos(angleOnRing * 13.0 - phase * 3.0)), 18.0);
        float movingPulse = pow(max(0.0, cos(angleOnRing * 2.0 - phase * 5.0)), 42.0);
        vec3 color = tint * halo * 0.16;
        color += mix(vec3(0.018, 0.13, 0.24), tint, 0.58) * tube * (0.62 + nearSide * 0.72);
        color += tint * core * (0.82 + nearSide * 1.04);
        color += mix(tint, vec3(0.86, 0.97, 1.0), 0.76) * innerEdge * nearSide * 1.34;
        color += mix(tint, vec3(0.78, 0.94, 1.0), 0.58) * outerEdge * (0.58 + nearSide * 0.7);
        color += mix(tint, vec3(1.0), 0.58) * core * (dataPulse * 0.5 + movingPulse) * 0.9;
        float alpha = max(tube * (0.46 + nearSide * 0.48), halo * 0.2);
        alpha = max(alpha, max(innerEdge, outerEdge) * 0.9);
        return vec4(color, alpha);
    }

    vec2 orbitNodePosition(
        float orbitAngle,
        float flatten,
        float radius,
        float travel
    ) {
        vec2 orbitPoint = vec2(cos(travel), sin(travel) * flatten) * radius;
        return rotate2d(-orbitAngle) * orbitPoint;
    }

    vec4 renderNode(
        vec2 p,
        float orbitAngle,
        float flatten,
        float radius,
        float travel,
        float size,
        vec3 tint
    ) {
        vec2 orbitPoint = orbitNodePosition(orbitAngle, flatten, radius, travel);
        float distanceToNode = length(p - orbitPoint);
        float glow = mask(distanceToNode, size * 3.8);
        float disc = mask(distanceToNode, size);
        float rim = mask(abs(distanceToNode - size * 0.78), size * 0.12);
        float lens = mask(length((p - orbitPoint) - vec2(-size * 0.24, size * 0.28)), size * 0.24);
        float center = mask(distanceToNode, size * 0.28);
        vec3 color = tint * glow * 0.22;
        color += mix(vec3(0.018, 0.09, 0.17), tint, 0.26) * disc * 0.82;
        color += tint * rim * 1.65;
        color += vec3(0.82, 0.96, 1.0) * lens * 0.62;
        color += mix(tint, vec3(0.94, 1.0, 1.0), 0.74) * center * 1.35;
        return vec4(color, max(max(disc * 0.93, rim), glow * 0.2));
    }

    void main() {
        vec2 resolution = max(u_resolution, vec2(1.0));
        vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
        p -= u_pointer * vec2(0.06, 0.042);

        float time = u_time * 0.001;
        float radius = length(p);
        float sphereRadius = 0.81;
        float sphere = 1.0 - smoothstep(sphereRadius - 0.012, sphereRadius + 0.014, radius);
        float outerShell = mask(abs(radius - sphereRadius), 0.035);
        float innerShell = mask(abs(radius - 0.735), 0.012);
        float normalizedRadius = clamp(radius / sphereRadius, 0.0, 1.0);
        float sphereDepth = sqrt(max(0.0, 1.0 - normalizedRadius * normalizedRadius));
        vec3 normal = normalize(vec3(p / sphereRadius, sphereDepth));
        vec3 lightDirection = normalize(vec3(-0.54 + u_pointer.x * 0.16, 0.7, 0.8));
        float diffuse = max(dot(normal, lightDirection), 0.0);
        float fresnel = sphere * pow(normalizedRadius, 4.2);
        float upperReflection = sphere * pow(max(normal.y, 0.0), 3.0) * (0.18 + diffuse * 0.26);

        vec3 deepBlue = vec3(0.012, 0.055, 0.12);
        vec3 glassBlue = vec3(0.04, 0.34, 0.72);
        vec3 iceBlue = vec3(0.08, 0.62, 1.0);
        vec3 mineralTeal = vec3(0.04, 0.87, 0.77);
        vec3 warmMetal = vec3(0.92, 0.65, 0.42);
        vec3 color = mix(deepBlue, glassBlue, 0.24) * sphere * (0.72 + diffuse * 0.3);
        float alpha = sphere * (0.3 + diffuse * 0.06);

        float refractedLines = sin((normal.x * 1.4 + normal.y * 0.9 + normal.z) * 46.0 - time * 0.34);
        refractedLines *= sin((normal.y - normal.x * 0.42) * 38.0 + time * 0.22);
        float glassCaustic = pow(abs(refractedLines), 8.0) * sphere * (0.12 + fresnel * 0.42);
        color += mix(glassBlue, mineralTeal, normalizedRadius) * glassCaustic * 0.86;
        color += glassBlue * upperReflection * 0.78;
        color += mix(iceBlue, vec3(0.72, 0.92, 1.0), 0.56) * outerShell * (0.58 + diffuse * 0.72);
        color += iceBlue * innerShell * 0.32;
        color += iceBlue * fresnel * 0.68;
        alpha = max(alpha, max(outerShell * 0.78, fresnel * 0.72));

        float latitude = pow(max(0.0, cos((normal.y + time * 0.007) * PI * 8.0)), 74.0);
        float longitude = pow(max(0.0, cos((atan(normal.x, normal.z) - time * 0.012) * 7.0)), 82.0);
        float innerGrid = (latitude + longitude) * sphere * (1.0 - fresnel) * 0.16;
        color += mix(glassBlue, mineralTeal, 0.32) * innerGrid;
        alpha = max(alpha, innerGrid * 0.34);

        float shellArc0 = ringMask(p, -0.08 + time * 0.006, 0.91, 0.71, 0.017) * sphere;
        float shellArc1 = ringMask(p, 1.08 - time * 0.004, 0.94, 0.67, 0.012) * sphere;
        float shellArc2 = ringMask(p, -1.0 + time * 0.003, 0.88, 0.76, 0.009) * sphere;
        color += glassBlue * shellArc0 * 0.5;
        color += iceBlue * shellArc1 * 0.34;
        color += mineralTeal * shellArc2 * 0.24;
        alpha = max(alpha, max(shellArc0 * 0.5, max(shellArc1, shellArc2) * 0.34));

        float a0 = 0.05 + time * 0.046 + u_pointer.x * 0.14;
        float a1 = -0.72 - time * 0.037 + u_pointer.y * 0.11;
        float a2 = 0.86 + time * 0.032 - u_pointer.x * 0.1;
        float a3 = 1.46 - time * 0.027 + u_pointer.y * 0.08;
        float a4 = -1.28 + time * 0.022;
        float a5 = 0.42 - time * 0.018 + u_pointer.x * 0.06;

        vec4 orbit0 = renderOrbit(p, a0, 0.28, 0.73, 0.06, time * 0.23, iceBlue);
        vec4 orbit1 = renderOrbit(p, a1, 0.38, 0.74, 0.052, -time * 0.19, mineralTeal);
        vec4 orbit2 = renderOrbit(p, a2, 0.23, 0.77, 0.045, time * 0.17, mix(iceBlue, warmMetal, 0.22));
        vec4 orbit3 = renderOrbit(p, a3, 0.47, 0.69, 0.023, -time * 0.14, iceBlue);
        vec4 orbit4 = renderOrbit(p, a4, 0.2, 0.8, 0.021, time * 0.11, mineralTeal);
        vec4 orbit5 = renderOrbit(p, a5, 0.58, 0.66, 0.014, -time * 0.09, glassBlue);
        vec4 orbitComposite = orbit0 + orbit1 + orbit2 + orbit3 + orbit4 + orbit5;
        color += orbitComposite.rgb;
        alpha = max(alpha, clamp(orbitComposite.a, 0.0, 1.0));

        vec4 node0 = renderNode(p, a0, 0.28, 0.73, time * 0.2 + 0.55, 0.078, iceBlue);
        vec4 node1 = renderNode(p, a1, 0.38, 0.74, -time * 0.15 + 2.3, 0.07, mineralTeal);
        vec4 node2 = renderNode(p, a2, 0.23, 0.77, time * 0.13 + 4.35, 0.074, mix(iceBlue, warmMetal, 0.18));
        vec4 node3 = renderNode(p, a3, 0.47, 0.69, -time * 0.11 + 5.42, 0.063, iceBlue);
        vec4 node4 = renderNode(p, a4, 0.2, 0.8, time * 0.09 + 3.12, 0.066, mineralTeal);
        vec4 node5 = renderNode(p, a5, 0.58, 0.66, -time * 0.08 + 1.28, 0.058, glassBlue);
        vec4 nodeComposite = node0 + node1 + node2 + node3 + node4 + node5;
        color += nodeComposite.rgb * (1.0 + u_energy * 0.36);
        alpha = max(alpha, clamp(nodeComposite.a, 0.0, 1.0));

        vec2 nodePosition0 = orbitNodePosition(a0, 0.28, 0.73, time * 0.2 + 0.55);
        vec2 nodePosition1 = orbitNodePosition(a1, 0.38, 0.74, -time * 0.15 + 2.3);
        vec2 nodePosition2 = orbitNodePosition(a2, 0.23, 0.77, time * 0.13 + 4.35);
        vec2 nodePosition3 = orbitNodePosition(a3, 0.47, 0.69, -time * 0.11 + 5.42);
        vec2 nodePosition4 = orbitNodePosition(a4, 0.2, 0.8, time * 0.09 + 3.12);
        vec2 nodePosition5 = orbitNodePosition(a5, 0.58, 0.66, -time * 0.08 + 1.28);
        float spokeGlow = 0.0;
        float spokeCore = 0.0;
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition0, 0.024);
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition1, 0.022);
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition2, 0.022);
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition3, 0.018);
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition4, 0.018);
        spokeGlow += segmentMask(p, vec2(0.0), nodePosition5, 0.016);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition0, 0.0045);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition1, 0.004);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition2, 0.004);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition3, 0.0035);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition4, 0.0035);
        spokeCore += segmentMask(p, vec2(0.0), nodePosition5, 0.003);
        float constellation = 0.0;
        constellation += segmentMask(p, nodePosition0, nodePosition3, 0.0025);
        constellation += segmentMask(p, nodePosition1, nodePosition4, 0.0025);
        constellation += segmentMask(p, nodePosition2, nodePosition5, 0.0025);
        color += glassBlue * spokeGlow * 0.12;
        color += mix(iceBlue, mineralTeal, 0.36) * spokeCore * (0.58 + u_energy * 0.45);
        color += glassBlue * constellation * 0.32;
        alpha = max(alpha, min(spokeCore * 0.52 + spokeGlow * 0.08 + constellation * 0.22, 0.74));

        vec2 corePoint = rotate2d(PI * 0.25 + time * 0.095) * p;
        vec2 counterCorePoint = rotate2d(-PI * 0.25 - time * 0.062) * p;
        vec2 innerCorePoint = rotate2d(PI * 0.25 + time * 0.028) * p;
        float coreBoxOuter = boxLine(corePoint, vec2(0.135), 0.018);
        float coreBox = boxLine(counterCorePoint, vec2(0.097), 0.014);
        float coreBoxInner = boxLine(innerCorePoint, vec2(0.057), 0.011);
        float coreGlow = exp(-(38.0 - u_energy * 9.0) * dot(p, p));
        float coreHot = exp(-(132.0 - u_energy * 22.0) * dot(p, p));
        float coreBeamX = mask(abs(corePoint.x), 0.0045) * mask(length(p), 0.39);
        float coreBeamY = mask(abs(corePoint.y), 0.0045) * mask(length(p), 0.39);
        vec2 cubeOffset = vec2(-0.038, 0.04);
        vec2 frontTop = vec2(0.0, 0.14);
        vec2 frontRight = vec2(0.14, 0.0);
        vec2 frontBottom = vec2(0.0, -0.14);
        vec2 frontLeft = vec2(-0.14, 0.0);
        float cubeConnectors = 0.0;
        cubeConnectors += segmentMask(corePoint, frontTop, frontTop + cubeOffset, 0.006);
        cubeConnectors += segmentMask(corePoint, frontRight, frontRight + cubeOffset, 0.006);
        cubeConnectors += segmentMask(corePoint, frontBottom, frontBottom + cubeOffset, 0.006);
        cubeConnectors += segmentMask(corePoint, frontLeft, frontLeft + cubeOffset, 0.006);
        float coreRing0 = mask(abs(radius - 0.205), 0.004);
        float coreRing1 = mask(abs(radius - 0.315), 0.003);
        float coreRing2 = mask(abs(radius - 0.44), 0.0025);
        float rayAngle = atan(p.y, p.x) + time * 0.025;
        float starRays = pow(max(0.0, cos(rayAngle * 8.0)), 96.0);
        starRays *= (1.0 - smoothstep(0.08, 0.6, radius)) * sphere;
        color += glassBlue * coreBoxOuter * 1.45;
        color += iceBlue * coreBox * 2.15;
        color += mineralTeal * coreBoxInner * 1.85;
        color += mix(iceBlue, vec3(0.86, 0.98, 1.0), 0.64) * coreGlow * (1.85 + u_energy * 0.55);
        color += vec3(0.9, 1.0, 1.0) * coreHot * 2.2;
        color += mix(iceBlue, mineralTeal, 0.44) * (coreBeamX + coreBeamY) * 0.6;
        color += mix(iceBlue, vec3(0.92, 1.0, 1.0), 0.62) * starRays * (0.72 + u_energy * 0.5);
        color += mix(iceBlue, mineralTeal, 0.34) * cubeConnectors * 1.18;
        color += glassBlue * coreRing0 * 0.58;
        color += mix(glassBlue, iceBlue, 0.5) * coreRing1 * 0.42;
        color += glassBlue * coreRing2 * 0.28;
        alpha = max(alpha, max(max(coreBoxOuter, coreBox), coreBoxInner));
        alpha = max(alpha, max(max(coreGlow * 0.98, min(cubeConnectors, 1.0)), starRays * 0.74));

        float particles = 0.0;
        float particleGlow = 0.0;
        for (int i = 0; i < 48; i++) {
            float fi = float(i);
            float seed = hash21(vec2(fi, fi * 1.37));
            float depth = fract(seed * 5.87 + fi * 0.071);
            float particleAngle = seed * PI * 2.0 + time * (0.055 + mod(fi, 5.0) * 0.011);
            float particleRadius = 0.11 + fract(seed * 7.13) * 0.62;
            vec2 position = vec2(cos(particleAngle), sin(particleAngle) * (0.38 + depth * 0.42));
            position = rotate2d(fi * 0.37) * position * particleRadius;
            float size = 0.0035 + depth * 0.0065;
            float distanceToParticle = length(p - position);
            particles += mask(distanceToParticle, size);
            particleGlow += mask(distanceToParticle, size * 4.0) * (0.18 + depth * 0.2);
        }
        particles *= sphere;
        particleGlow *= sphere;
        color += mix(iceBlue, mineralTeal, 0.42) * (particles * 1.85 + particleGlow * 0.45);
        alpha = max(alpha, min(particles + particleGlow * 0.24, 1.0));

        float energySweepAngle = atan(p.y, p.x) + time * 0.24;
        float energySweep = pow(max(0.0, cos(energySweepAngle)), 64.0) * mask(abs(radius - 0.56), 0.28) * sphere;
        color += mix(iceBlue, mineralTeal, 0.3) * energySweep * (0.38 + u_energy * 0.48);

        float softAura = exp(-2.05 * radius * radius) * 0.21;
        float outerAura = mask(abs(radius - 0.86), 0.17) * 0.13;
        color += mix(deepBlue, iceBlue, 0.4) * softAura;
        color += glassBlue * outerAura;
        alpha = max(alpha, max(softAura * 0.58, outerAura * 0.36));

        float pedestalY = p.y + 0.9;
        vec2 pedestalPoint = vec2(p.x, pedestalY / 0.18);
        float pedestalOuter = 1.0 - smoothstep(0.73, 0.76, length(pedestalPoint));
        float pedestalInner = 1.0 - smoothstep(0.56, 0.59, length(pedestalPoint));
        float pedestal = max(pedestalOuter - pedestalInner * 0.82, 0.0);
        float pedestalRim = mask(abs(length(pedestalPoint) - 0.69), 0.018);
        vec2 basePoint = vec2(p.x, (p.y + 0.93) / 0.11);
        float baseOuter = 1.0 - smoothstep(0.82, 0.85, length(basePoint));
        float baseInner = 1.0 - smoothstep(0.64, 0.67, length(basePoint));
        float baseRing = max(baseOuter - baseInner, 0.0);
        float groundReflection = exp(-14.0 * p.x * p.x - 260.0 * (p.y + 0.84) * (p.y + 0.84));
        color += mix(vec3(0.009, 0.022, 0.05), glassBlue, 0.2) * pedestal * 1.4;
        color += iceBlue * pedestalRim * 0.82;
        color += mix(deepBlue, iceBlue, 0.32) * baseRing * 0.94;
        color += iceBlue * groundReflection * 0.34;
        alpha = max(alpha, max(pedestalOuter * 0.94, baseOuter * 0.9));

        color = color / (vec3(1.0) + color * 0.36);
        color = pow(color, vec3(0.84));
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    }
`;

/**
 * Trusted, first-party renderer appended after promotion-page sanitization.
 * The CSP allows this exact source by hash; merchant-authored scripts remain blocked.
 */
export const PROMOTION_VISUAL_SCRIPT = String.raw`(() => {
    'use strict';

    const stage = document.querySelector('[data-promo-signal-stage]');
    const canvas = document.querySelector('[data-promo-signal-canvas]');
    if (!(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, energy: 0 };
    let frame = 0;
    let visible = !document.hidden;
    let renderFrame = () => undefined;

    const updatePointer = event => {
        const bounds = stage.getBoundingClientRect();
        const nextX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
        const nextY = 1 - ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2;
        pointer.energy = Math.min(
            1,
            pointer.energy + Math.hypot(nextX - pointer.targetX, nextY - pointer.targetY) * 0.8,
        );
        pointer.targetX = nextX;
        pointer.targetY = nextY;
    };

    const clearPointer = () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
    };

    stage.addEventListener('pointermove', updatePointer, { passive: true });
    stage.addEventListener('pointerleave', clearPointer, { passive: true });

    const resizeCanvas = () => {
        const bounds = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
        const width = Math.max(1, Math.round(bounds.width * dpr));
        const height = Math.max(1, Math.round(bounds.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        renderFrame(performance.now(), true);
    };

    const vertexSource = ${JSON.stringify(VERTEX_SHADER_SOURCE)};
    const fragmentSource = ${JSON.stringify(FRAGMENT_SHADER_SOURCE)};

    const compileShader = (gl, type, source) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };

    const startWebGl = () => {
        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: true,
            depth: false,
            powerPreference: 'high-performance',
            premultipliedAlpha: false,
        });
        if (!gl) return false;

        const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
        const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
        if (!vertex || !fragment) return false;

        const program = gl.createProgram();
        if (!program) return false;
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW,
        );

        gl.useProgram(program);
        const position = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const resolution = gl.getUniformLocation(program, 'u_resolution');
        const pointerUniform = gl.getUniformLocation(program, 'u_pointer');
        const timeUniform = gl.getUniformLocation(program, 'u_time');
        const energyUniform = gl.getUniformLocation(program, 'u_energy');

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        renderFrame = (time, force = false) => {
            if (!force && (!visible || reducedMotion.matches)) return;
            pointer.x += (pointer.targetX - pointer.x) * 0.045;
            pointer.y += (pointer.targetY - pointer.y) * 0.045;
            pointer.energy += (0 - pointer.energy) * 0.025;
            stage.style.setProperty('--signal-x', (pointer.x * 8).toFixed(2) + 'px');
            stage.style.setProperty('--signal-y', (-pointer.y * 6).toFixed(2) + 'px');
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.uniform2f(resolution, canvas.width, canvas.height);
            gl.uniform2f(pointerUniform, pointer.x, pointer.y);
            gl.uniform1f(timeUniform, reducedMotion.matches ? 0 : time);
            gl.uniform1f(energyUniform, reducedMotion.matches ? 0 : pointer.energy);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            stage.classList.add('is-rendered');
            stage.dataset.renderer = 'webgl';
        };

        return true;
    };

    const startCanvasFallback = () => {
        const context = canvas.getContext('2d');
        if (!context) return;

        renderFrame = time => {
            const width = canvas.width;
            const height = canvas.height;
            const scale = Math.min(width, height);
            const centerX = width * 0.5 + pointer.x * scale * 0.018;
            const centerY = height * 0.48 - pointer.y * scale * 0.012;
            const radius = scale * 0.31;
            pointer.x += (pointer.targetX - pointer.x) * 0.045;
            pointer.y += (pointer.targetY - pointer.y) * 0.045;
            pointer.energy += (0 - pointer.energy) * 0.025;
            context.clearRect(0, 0, width, height);

            const sphereGradient = context.createRadialGradient(
                centerX - radius * 0.22,
                centerY - radius * 0.28,
                radius * 0.05,
                centerX,
                centerY,
                radius,
            );
            sphereGradient.addColorStop(0, 'rgba(70, 200, 255, .38)');
            sphereGradient.addColorStop(0.45, 'rgba(14, 91, 181, .21)');
            sphereGradient.addColorStop(0.86, 'rgba(5, 26, 55, .12)');
            sphereGradient.addColorStop(1, 'rgba(77, 181, 255, .62)');
            context.fillStyle = sphereGradient;
            context.beginPath();
            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
            context.fill();

            context.save();
            context.strokeStyle = 'rgba(120, 206, 255, .32)';
            context.lineWidth = Math.max(2, scale * 0.004);
            context.beginPath();
            context.arc(centerX, centerY, radius * 1.06, 0, Math.PI * 2);
            context.stroke();
            context.strokeStyle = 'rgba(51, 128, 219, .22)';
            context.lineWidth = Math.max(1, scale * 0.002);
            context.beginPath();
            context.arc(centerX, centerY, radius * 0.92, 0, Math.PI * 2);
            context.stroke();
            context.restore();

            const elapsed = reducedMotion.matches ? 0 : time * 0.000055;
            const colors = ['rgba(67, 177, 255, .9)', 'rgba(46, 232, 201, .78)', 'rgba(255, 198, 126, .62)'];
            for (let index = 0; index < 7; index += 1) {
                context.save();
                context.translate(centerX, centerY);
                context.rotate(elapsed * (index % 2 ? -1 : 1) + index * 0.58);
                context.scale(1, 0.23 + index * 0.05);
                context.shadowColor = colors[index % colors.length];
                context.shadowBlur = scale * 0.018;
                context.strokeStyle = colors[index % colors.length];
                context.lineWidth = Math.max(2, scale * (0.011 - index * 0.0008));
                context.beginPath();
                context.arc(0, 0, radius * (0.88 + index * 0.028), 0, Math.PI * 2);
                context.stroke();

                const travel = elapsed * (index % 2 ? -3 : 2.5) + index * 1.14;
                const nodeX = Math.cos(travel) * radius * (0.88 + index * 0.028);
                const nodeY = Math.sin(travel) * radius * (0.88 + index * 0.028);
                context.fillStyle = 'rgba(8, 31, 60, .92)';
                context.strokeStyle = colors[index % colors.length];
                context.lineWidth = Math.max(2, scale * 0.004);
                context.beginPath();
                context.arc(nodeX, nodeY, radius * (0.055 + (index % 3) * 0.008), 0, Math.PI * 2);
                context.fill();
                context.stroke();
                context.restore();
            }

            for (let index = 0; index < 26; index += 1) {
                const seed = Math.sin(index * 73.13) * 43758.5453;
                const normalizedSeed = seed - Math.floor(seed);
                const angle = normalizedSeed * Math.PI * 2 + elapsed * (1 + (index % 5) * 0.18);
                const particleRadius = radius * (0.15 + ((normalizedSeed * 7.31) % 1) * 0.68);
                const particleX = centerX + Math.cos(angle) * particleRadius;
                const particleY = centerY + Math.sin(angle) * particleRadius * (0.4 + (index % 4) * 0.09);
                const particleSize = Math.max(1.2, scale * (0.002 + (index % 3) * 0.0008));
                context.fillStyle = index % 3 === 1 ? 'rgba(68, 228, 204, .76)' : 'rgba(102, 196, 255, .72)';
                context.beginPath();
                context.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
                context.fill();
            }

            const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 0.32);
            core.addColorStop(0, 'rgba(226, 250, 255, 1)');
            core.addColorStop(0.2, 'rgba(60, 183, 255, .95)');
            core.addColorStop(1, 'rgba(30, 202, 195, 0)');
            context.fillStyle = core;
            context.beginPath();
            context.arc(centerX, centerY, radius * 0.32, 0, Math.PI * 2);
            context.fill();

            const coreRotation = reducedMotion.matches ? 0 : time * 0.000095;
            context.save();
            context.translate(centerX, centerY);
            context.rotate(Math.PI * 0.25 + coreRotation);
            context.strokeStyle = 'rgba(108, 215, 255, .96)';
            context.lineWidth = Math.max(2, scale * 0.007);
            context.strokeRect(-radius * 0.16, -radius * 0.16, radius * 0.32, radius * 0.32);
            context.rotate(-coreRotation * 1.65);
            context.strokeStyle = 'rgba(62, 232, 205, .86)';
            context.lineWidth = Math.max(2, scale * 0.005);
            context.strokeRect(-radius * 0.105, -radius * 0.105, radius * 0.21, radius * 0.21);
            context.restore();

            context.save();
            context.translate(centerX, centerY + radius * 1.17);
            context.scale(1, 0.18);
            context.strokeStyle = 'rgba(65, 165, 255, .58)';
            context.lineWidth = Math.max(5, scale * 0.012);
            context.beginPath();
            context.arc(0, 0, radius * 0.95, 0, Math.PI * 2);
            context.stroke();
            context.strokeStyle = 'rgba(117, 213, 255, .34)';
            context.lineWidth = Math.max(2, scale * 0.004);
            context.beginPath();
            context.arc(0, 0, radius * 1.13, 0, Math.PI * 2);
            context.stroke();
            context.restore();
            stage.classList.add('is-rendered');
            stage.dataset.renderer = 'canvas';
        };
    };

    if (!startWebGl()) startCanvasFallback();

    const animate = time => {
        renderFrame(time);
        if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
    };

    const restart = () => {
        cancelAnimationFrame(frame);
        resizeCanvas();
        if (!reducedMotion.matches && visible) frame = requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    reducedMotion.addEventListener('change', restart);
    document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
        restart();
    });

    resizeCanvas();
    restart();
})();`;

export const PROMOTION_VISUAL_SCRIPT_SHA256 = createHash('sha256')
    .update(PROMOTION_VISUAL_SCRIPT)
    .digest('base64');
