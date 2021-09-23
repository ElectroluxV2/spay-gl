import { Point } from './point.js';
import { Hexagon } from './hexagon.js';
import { Layout } from './layout.js';
import { Orientation } from './orientation.js';
import { Vector } from './vector.js';
import { Matrix } from './matrix.js';

export class Renderer {
    static #HEXAGON_SIZE = new Point(20, 20);
    static #BACKGROUND_COLOR = [0.25, 0.25, 0.25, 1];
    static #MAXIMUM_ZOOM_ARGUMENT = 4;
    static #MINIMUM_ZOOM_ARGUMENT = -8;
    static #ZOOM_FUNCTION = x => Math.pow((x / 10) + 1, 2);

    #gl;
    #program;

    #matrixLocation;

    #transform;
    #offset;
    #origin;
    #scale;
    #layout;
    #currentZoomArgument;

    #vertexCount;

    camera = {
        x: 0,
        y: 0,
        rotation: 0,
        zoom: 1,
    };

    /**
     * 
     * @param {WebGL2RenderingContext} gl
     */
    constructor(gl) {
        this.#gl = gl;
        this.#load();

        this.#scale = new Point(1, 1);
        this.#transform = new Point(0, 0);
        this.#offset = new Point(0, 0);
        this.#origin = new Point(0, 0);
        this.#layout = new Layout(Orientation.FLAT, Renderer.#HEXAGON_SIZE, new Point(0, 0));
        this.#currentZoomArgument = 0;

        // this.updateViewProjection();
    }

    /**
     * 
     * @param {Point} hexagonCorner 
     * @param {Point} hexagonCenter 
     * @param {Number} widthMultiplier 
     * @returns {Point}
     */
    static borderCorner(hexagonCorner, hexagonCenter, widthMultiplier) {
        return Vector.makeVector(hexagonCorner, hexagonCenter).multiply(widthMultiplier).add(hexagonCenter);
        // return hexagonCenter.add(new Point(hexagonCorner.x - hexagonCenter.x, hexagonCorner.y - hexagonCenter.y).multiply(widthMultiplier));
    }

    /**
     * Converts hexagon to hexagon's center on screen
     * @param {Hexagon} hexagon
     * @returns {Point}
     */
    hexagonToPixel(hexagon) {
        const o = this.#layout.orientation;
        const x = (o.f[0] * hexagon.q + o.f[1] * hexagon.r) * this.#layout.size.x * this.scale.x;
        const y = (o.f[2] * hexagon.q + o.f[3] * hexagon.r) * this.#layout.size.y * this.scale.y;
        return new Point(x + this.#transform.x + this.#offset.x, y + this.#transform.y + this.#offset.y);
    }

    /**
     * Converts screen pixel to hexagon
     * @param {Point} pixel
     * @returns {Hexagon}
     */
    pixelToHexagon(pixel) {
        const o = this.#layout.orientation;
        const pt = new Point((pixel.x - this.#transform.x - this.#offset.x) / (this.#layout.size.x * this.#scale.x), (pixel.y - this.#transform.y - this.#offset.y) / (this.#layout.size.y * this.#scale.y));
        const q = o.b[0] * pt.x + o.b[1] * pt.y;
        const r = o.b[2] * pt.x + o.b[3] * pt.y;
        const s = -q - r;

        let qi = Math.round(q);
        let ri = Math.round(r);
        let si = Math.round(s);

        const qDiff = Math.abs(qi - q);
        const rDiff = Math.abs(ri - r);
        const sDiff = Math.abs(si - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            qi = -ri - si;
        } else if (rDiff > sDiff) {
            ri = -qi - si;
        } else {
            si = -qi - ri;
        }

        return new Hexagon(qi, ri, si);
    }

    async #load() {
        // Get shaders source
        const vertexShaderSource =
            `#version 300 es

            layout (location=0) in vec2 a_position;
            layout (location=1) in vec3 color;

            uniform mat3 u_matrix;
            out vec3 vColor;
    
            void main() {
                gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
                vColor = color;
            }`;
    
        const fragmentShaderSource = 
            `#version 300 es
            precision highp float; // lowp, mediump, highp
    
            in vec3 vColor;
            out vec4 fragColor;
    
            void main() {
                fragColor = vec4(vColor, 1.0);
            }`;


        // Cleaner code, same variables
        const gl = this.#gl;

        gl.clearColor(...Renderer.#BACKGROUND_COLOR);

        // Compile shaders
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error(`Failed to compile Vertex Shader!`, gl.getShaderInfoLog(vertexShader));
        }
 
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error(`Failed to compile Fragment Shader!`, gl.getShaderInfoLog(fragmentShader));
        }


        // Link shaders to WebGL program
        this.#program = gl.createProgram();
        const program = this.#program;

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`Failed to link program!`, gl.getProgramInfoLog(program));
        }

        // Finally, activate WebGL program
        gl.useProgram(program);

        // Save locations
        this.#matrixLocation = gl.getUniformLocation(program, "u_matrix");
    }

    *getTrianglesFromHexagon(hexagon) {
        const hexagonCorners = this.#layout.hexagonCorners(hexagon);
        const hexagonCenter = this.#layout.hexagonToPixelUntransformed(hexagon);

        for (let i = 0; i < 6; i++) {
            yield [(hexagonCenter), (hexagonCorners[i]), (hexagonCorners[(i + 1) % 6])];
        }
    };

    /**
     * @param {Float32Array} value
     */
    set vertices(value) {

        const gl = this.#gl;
        const verticesBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, verticesBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, value, gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        this.#vertexCount = value.length / 2;
    }

    /**
     * @param {Float32Array} value
     */
    set colors(value) {

        const gl = this.#gl;
        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, value, gl.STATIC_DRAW);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(1);
    }

    viewProjectionMat;

    updateViewProjection() {
        const projectionMat = Matrix.projection(this.#gl.canvas.width, this.#gl.canvas.height);

        let cameraMat = Matrix.identity();
        cameraMat = Matrix.translate(cameraMat, this.camera.x, this.camera.y);
        cameraMat = Matrix.translate(cameraMat, this.#transform.x, this.#transform.y);
        cameraMat = Matrix.rotate(cameraMat, this.camera.rotation);
        cameraMat = Matrix.scale(cameraMat, ...this.#scale);

        const viewMat = Matrix.inverse(cameraMat);
        this.viewProjectionMat = Matrix.multiply(projectionMat, viewMat);
    }

    curr = 0;
    draw() {
        // console.time('DRAW');
        const gl = this.#gl;

        this.curr += 0.01;

        if (false && Math.sign(Math.tan(this.curr)) === 1)
            this.doZoom(Math.sign(Math.sin(this.curr)) * 0.01, new Point(this.camera.x, this.camera.y));
        

        this.updateViewProjection();


        // Set the matrix.
        gl.uniformMatrix3fv(this.#matrixLocation, false, this.viewProjectionMat);

        // Draw latest triangles TODO: make this multi call instead of one big array
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, this.#vertexCount);
        
        // console.timeEnd('DRAW');
    }

    /**
     * 
     * @param {Point} pointer 
     * @returns {Point}
     */
    getClipSpacePosition(pointer) {
        const normalizedX = pointer.x / this.#gl.canvas.width;
        const normalizedY = pointer.y / this.#gl.canvas.height;
      
        // convert to clip space
        const clipX = normalizedX *  2 - 1;
        const clipY = normalizedY * -2 + 1;
        
        return new Point(clipX, clipY);
    }

    doZoom(change, pointer) {
        const clip = this.getClipSpacePosition(pointer);

        // position before zooming
        const preZoom = Matrix.transformPoint(Matrix.inverse(this.viewProjectionMat), new Point(clip.x, clip.y));

        this.zoom += change;

        this.updateViewProjection();

        // position after zooming
        const postZoom = Matrix.transformPoint(Matrix.inverse(this.viewProjectionMat), new Point(clip.x, clip.y));

        // camera needs to be moved the difference of before and after
        this.camera.x += preZoom.x - postZoom.x;
        this.camera.y += preZoom.y - postZoom.y;
    }


    startInvViewProjMat;
    startCamera;
    startPos;
    startClipPos;
    startMousePos;

    moveCamera(pointer) {
        const pos = Matrix.transformPoint(this.startInvViewProjMat, this.getClipSpacePosition(pointer));
          
        this.camera.x = this.startCamera.x + this.startPos.x - pos.x;
        this.camera.y = this.startCamera.y + this.startPos.y - pos.y;
    }

    onPointerDown(pointer) {
        this.startInvViewProjMat = Matrix.inverse(this.viewProjectionMat);
        this.startCamera = Object.assign({}, this.camera);
        this.startClipPos = this.getClipSpacePosition(pointer);
        this.startPos = Matrix.transformPoint(this.startInvViewProjMat, this.startClipPos);
        this.startMousePos = pointer;
    }

    onPointerDrag(pointer) {
        this.moveCamera(pointer);
    }

    onPointerUp(pointer) {
        
    }

    get currentZoom() {
        return Renderer.#ZOOM_FUNCTION(this.#currentZoomArgument);
    }

    get zoom() {
        return this.#currentZoomArgument;
    }

    set zoom(value) {
        this.#currentZoomArgument = Math.clamp(value,  Renderer.#MINIMUM_ZOOM_ARGUMENT, Renderer.#MAXIMUM_ZOOM_ARGUMENT);
        this.#scale.x = this.#scale.y = this.currentZoom;
    }
}