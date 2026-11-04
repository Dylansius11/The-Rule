import json
import pathlib
import sys

url, digest, output = sys.argv[1:]
request = json.dumps({"source":{"WasmUrl":{"url":url,"hash":digest,"build_target":"wasm32-wasip2"}},"resource_limits":{"max_instructions":1000000000,"max_memory_mb":128,"max_execution_seconds":60},"input_data":json.dumps({"op":"derive","round":1,"seed":"t1-a"}),"response_format":"Json"}, separators=(',', ':')).encode()
account, method = b'outlayer.testnet', b'request_execution'
def data(s): return ''.join('\\%02x' % b for b in s)
# promise_create reads a little-endian u128 deposit at offset zero.
amount = (7000100000000000000000).to_bytes(16, 'little')
wat = f'''(module
  (import "env" "promise_create" (func $create (param i64 i64 i64 i64 i64 i64 i64 i64) (result i64)))
  (import "env" "promise_return" (func $return (param i64)))
  (memory (export "memory") 1)
  (data (i32.const 0) "{data(amount)}")
  (data (i32.const 32) "{data(account)}")
  (data (i32.const 64) "{data(method)}")
  (data (i32.const 128) "{data(request)}")
  (func (export "probe")
    i64.const {len(account)} i64.const 32 i64.const {len(method)} i64.const 64
    i64.const {len(request)} i64.const 128 i64.const 0 i64.const 100000000000000
    call $create call $return))'''
pathlib.Path(output).write_text(wat)
