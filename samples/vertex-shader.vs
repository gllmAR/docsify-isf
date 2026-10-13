/*
 * Companion vertex shader for vertex-shader.fs.
 * ISF hosts load a .vs file with the same base name automatically and call
 * isf_vertShaderInit() to get gl_Position and isf_FragNormCoord set up.
 */

varying vec2 vUV;

void main()
{
    isf_vertShaderInit();
    vUV = isf_FragNormCoord;
}
