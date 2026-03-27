// main.js
import { FPSCounter } from "./fps.js";
import { mat4, vec3 } from "https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js";

export async function initWebGPU() {
    if (!navigator.gpu) throw new Error("WebGPU не підтримується цим браузером");

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("webgpu");

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const fps = new FPSCounter();
    document.body.appendChild(fps.domElement);

    // ---------- Параметри ----------
    const NUM_PARTICLES = 500000;
    const VERTS_PER_PARTICLE = 6;
    const PARTICLE_STRIDE = 10;

    const quadOffsets = [
        [-1, -1], [1, -1], [1, 1],
        [-1, -1], [1, 1], [-1, 1],
    ];

    const particles = new Float32Array(NUM_PARTICLES * VERTS_PER_PARTICLE * PARTICLE_STRIDE);
    for (let i = 0; i < NUM_PARTICLES; i++) {
        const basePos = [
            (Math.random() - 0.5) * 50,
            (Math.random() - 0.5) * 50,
            (Math.random() - 0.5) * 50,
        ];
        const size = Math.random() * 0.5 + 0.12;
        const color = [Math.random(), Math.random(), Math.random()];

        for (let v = 0; v < VERTS_PER_PARTICLE; v++) {
            const idx = (i * VERTS_PER_PARTICLE + v) * PARTICLE_STRIDE;
            particles[idx + 0] = basePos[0];
            particles[idx + 1] = basePos[1];
            particles[idx + 2] = basePos[2];
            particles[idx + 3] = size;
            particles[idx + 4] = color[0];
            particles[idx + 5] = color[1];
            particles[idx + 6] = color[2];
            particles[idx + 7] = quadOffsets[v][0];
            particles[idx + 8] = quadOffsets[v][1];
            particles[idx + 9] = 0;
        }
    }

    const particleBuffer = device.createBuffer({
        size: particles.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(particleBuffer, 0, particles);

    // ---------- Уніформ ----------
    const uniformBufferSize = 432; // вирівняно до 16 байт
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // ---------- Шейдер ----------
    const shaderModule = device.createShaderModule({
        code: `
        struct Light {
            position : vec3<f32>,
            _pad1 : f32,
            color : vec3<f32>,
            intensity : f32,
        };
        struct Uniforms {
            mvpMatrix : mat4x4<f32>,
            viewMatrix : mat4x4<f32>,
            cameraPos : vec3<f32>,
            _pad0 : f32,
            cameraRight : vec3<f32>,
            _pad1 : f32,
            cameraUp : vec3<f32>,
            _pad2 : f32,
            lights : array<Light, 8>,
        }
        @group(0) @binding(0) var<uniform> uniforms : Uniforms;

        struct VertexOut {
            @builtin(position) Position : vec4<f32>,
            @location(0) worldPos : vec3<f32>,
            @location(1) color : vec3<f32>,
            @location(2) normal : vec3<f32>,
        };

        @vertex
        fn vs_main(
            @location(0) position : vec3<f32>,
            @location(1) size : f32,
            @location(2) color : vec3<f32>,
            @location(3) quadOffset : vec2<f32>
        ) -> VertexOut {
            var out : VertexOut;
            let right = uniforms.cameraRight * quadOffset.x * size;
            let up = uniforms.cameraUp * quadOffset.y * size;
            let worldPos = position + right + up;

            out.Position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
            out.worldPos = worldPos;
            out.color = color;
            out.normal = normalize(-uniforms.cameraUp);
            return out;
        }

        @fragment
        fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
            var resultColor = vec3<f32>(0.0);
            let normal = normalize(in.normal);
            let fragPos = in.worldPos;

            for (var i = 0u; i < 8u; i = i + 1u) {
                let light = uniforms.lights[i];
                let lightDir = normalize(light.position - fragPos);
                let dist = length(light.position - fragPos);
                let attenuation = light.intensity / (1.0 + 0.1 * dist * dist);
                let diff = max(dot(normal, lightDir), 0.0);
                resultColor += diff * light.color * attenuation;
            }

            let finalColor = in.color * resultColor;
            return vec4<f32>(finalColor, 1.0);
        }
        `,
    });

    // ---------- Пайплайн ----------
    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            buffers: [{
                arrayStride: PARTICLE_STRIDE * 4,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 3 * 4, format: "float32" },
                    { shaderLocation: 2, offset: 4 * 4, format: "float32x3" },
                    { shaderLocation: 3, offset: 7 * 4, format: "float32x2" },
                ],
            }],
        },
        fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
        depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
    });

    let depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            depthTexture.destroy();
            depthTexture = device.createTexture({
                size: [w, h],
                format: "depth24plus",
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        }
    }

    // ---------- Рендер-цикл ----------
    let t = 0;
    function frame() {
        resizeCanvas();
        t += 0.004;

        const model = mat4.create();
        const view = mat4.create();
        const proj = mat4.create();

        const eye = vec3.fromValues(Math.sin(t) * 60, 20, Math.cos(t) * 60);
        const center = vec3.fromValues(0,0,0);
        const up = vec3.fromValues(0,1,0);
        mat4.lookAt(view, eye, center, up);
        mat4.perspective(proj, Math.PI/4, canvas.width/canvas.height, 0.1, 200);

        const mvp = mat4.create();
        mat4.multiply(mvp, proj, view);

        // camera right/up
        const right = vec3.fromValues(view[0], view[4], view[8]);
        const upVec = vec3.fromValues(view[1], view[5], view[9]);

        device.queue.writeBuffer(uniformBuffer, 0, mvp);
        device.queue.writeBuffer(uniformBuffer, 64, view);
        // cameraPos + cameraRight + cameraUp = 48 байт
        const cameraData = new Float32Array([...eye,0, ...right,0, ...upVec,0]);
        device.queue.writeBuffer(uniformBuffer, 128, cameraData);

        // ---------- 8 джерел світла ----------
        const lights = new Float32Array(8 * 8); // 8*32 bytes
		const lightColors = [
			[1,0,0],
			[0,1,0],
			[0,0,1],
			[1,1,0],
			[1,0,1],
			[0,1,1],
			[1,1,1],
			[0.8,0.5,0.2],
		];

        for (let i = 0; i < 8; i++) {
			const angle = t + i * Math.PI / 4;
			const pos = [Math.sin(angle)*30, Math.cos(angle*1.5)*15, Math.cos(angle)*30];
			const color = lightColors[i];
			const intensity = 25.5;
			const base = i*8;
			lights.set(pos, base);
			lights[base+3] = 0;
			lights.set(color, base+4);
			lights[base+7] = intensity;
		}
        device.queue.writeBuffer(uniformBuffer, 176, lights);

        const encoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: {r:0.00, g:0.00, b:0.00, a:1},
                loadOp:"clear",
                storeOp:"store",
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp:"clear",
                depthStoreOp:"store",
            },
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, particleBuffer);
        pass.setBindGroup(0, bindGroup);
        pass.draw(NUM_PARTICLES*VERTS_PER_PARTICLE);
        pass.end();

        device.queue.submit([encoder.finish()]);
        fps.update();
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

initWebGPU().catch(console.error);
