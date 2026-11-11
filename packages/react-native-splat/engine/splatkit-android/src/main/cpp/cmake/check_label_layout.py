"""Reflect the compiled binding, rather than trusting GLSL layout qualifiers."""
import struct
import sys
from pathlib import Path

words = struct.unpack('<' + 'I' * (Path(sys.argv[1]).stat().st_size // 4),
                      Path(sys.argv[1]).read_bytes())
types, decorations, offsets, variables = {}, {}, {}, {}
i = 5
while i < len(words):
    size, op = words[i] >> 16, words[i] & 65535
    args = words[i + 1:i + size]
    if op in (28, 29, 30, 32):
        types[args[0]] = (op, args[1:])
    elif op == 71:
        decorations[args[0], args[1]] = args[2:]
    elif op == 72 and args[2] == 35:
        offsets[args[0], args[1]] = args[3]
    elif op == 59:
        variables[args[1]] = args[0]
    i += size

binding = next(key for key in variables if decorations.get((key, 33)) == (11,)
               and decorations.get((key, 34)) == (0,))
block = types[variables[binding]][1][1]
palette, states = types[block][1]
assert [offsets[block, i] for i in range(2)] == [0, 320]
assert decorations[palette, 6] == (32,), 'palette stride must match LabelStyle'
assert decorations[states, 6] == (4,), 'state stride must match uint32_t'
style = types[palette][1][0]
# PartStyle has vec3, three scalar fields and vec2 padding.
assert [offsets[style, i] for i in range(5)] == [0, 12, 16, 20, 24]
print('Label palette offsets and array strides match CPU layout')

camera_binding = next(key for key in variables if decorations.get((key, 33)) == (0,)
                      and decorations.get((key, 34)) == (0,))
camera = types[variables[camera_binding]][1][1]
assert [offsets[camera, i] for i in range(14)] == [0, 64, 128, 136, 144, 152, 156, 160, 176, 180, 184, 188, 192, 208]
print('Camera reveal offsets match CPU layout')
