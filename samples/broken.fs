/*{
    "DESCRIPTION": "Deliberately broken shader used to self-test error reporting: the missing semicolon makes the WebGL compiler fail with a mapped file line.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ],
    "INPUTS": [
        {
            "NAME": "level",
            "TYPE": "float",
            "LABEL": "Level",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 1.0
        }
    ]
}*/

void main()
{
    vec4 color = vec4(level, 0.5, 0.25, 1.0)
    gl_FragColor = color;
}
