/*{
    "DESCRIPTION": "Custom vertex shader demo: the companion vertex-shader.vs passes a varying through, and the fragment shader uses it. Shows .fs + .vs pairing and isf_vertShaderInit().",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Vertex"
    ],
    "INPUTS": [
        {
            "NAME": "amp",
            "TYPE": "float",
            "LABEL": "Amplitude",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 2.0
        }
    ]
}*/

varying vec2 vUV;

void main()
{
    float distanceFromCenter = length(vUV - 0.5);
    float ring = 0.5 + 0.5 * sin(distanceFromCenter * 40.0 - TIME * 3.0);
    gl_FragColor = vec4(
        ring * (0.35 + 0.65 * amp),
        0.5 + 0.5 * sin(vUV.x * 10.0 + TIME),
        1.0 - ring,
        1.0);
}
