/*{
    "DESCRIPTION": "Demonstrates the IMPORTED key: the logo PNG next to this shader is loaded automatically and sampled with IMG_NORM_PIXEL.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Imported"
    ],
    "IMPORTED": {
        "logo": {
            "PATH": "isf-logo.png"
        }
    },
    "INPUTS": [
        {
            "NAME": "zoom",
            "TYPE": "float",
            "LABEL": "Zoom",
            "DEFAULT": 1.0,
            "MIN": 0.3,
            "MAX": 3.0
        },
        {
            "NAME": "spin",
            "TYPE": "float",
            "LABEL": "Spin",
            "DEFAULT": 0.15,
            "MIN": -1.0,
            "MAX": 1.0
        }
    ]
}*/

void main()
{
    vec2 uv = isf_FragNormCoord - 0.5;
    float angle = spin * TIME;
    float s = sin(angle);
    float c = cos(angle);
    mat2 rotation = mat2(c, -s, s, c);
    uv = rotation * uv / zoom + 0.5;

    vec4 logo = IMG_NORM_PIXEL(logo, uv);
    vec3 background = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + TIME + isf_FragNormCoord.xyx * 6.0);
    gl_FragColor = vec4(mix(background, logo.rgb, logo.a), 1.0);
}
