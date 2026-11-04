import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_bytes()
manifest = pathlib.Path(sys.argv[2]).read_bytes()
assert manifest.endswith(b'\n') and source.count(manifest) >= 1
index = source.rindex(manifest) + len(manifest) - 1
mutated = bytearray(source)
mutated[index] = 0x20
pathlib.Path(sys.argv[3]).write_bytes(mutated)
print('one byte changed at offset', index)
