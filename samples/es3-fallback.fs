/*{
    "DESCRIPTION": "GLSL ES 1.00 rejects indexing a local array with a non-constant expression, so this shader only compiles as ES 3.00. On WebGL2 the viewer automatically retries it as GLSL ES 3.00 and reports 'Compatibility mode'; on WebGL1-only browsers it shows the compile error.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ],
    "INPUTS": [
        {
            "NAME": "speed",
            "TYPE": "float",
            "LABEL": "Speed",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 3.0
        }
    ]
}*/

void main()
{
    float palette[4];
    palette[0] = 0.2;
    palette[1] = 0.5;
    palette[2] = 0.8;
    palette[3] = 1.0;

    // Dynamic index: legal in GLSL ES 3.00, not in ES 1.00.
    int index = int(mod(floor(gl_FragCoord.x / 64.0 + TIME * speed), 4.0));
    float value = palette[index];

    vec2 uv = isf_FragNormCoord;
    gl_FragColor = vec4(value * uv.x, value * uv.y, 1.0 - value, 1.0);
}
