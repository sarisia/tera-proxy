const Long = require('long'),
	log = require('../logger')

class Readable {
	constructor(buffer, position = 0) {
		this.buffer = buffer
		this.position = position
	}

	seek(n) { return this.position = n }
	skip(n) { return this.position += n }

	bool() {
		const ret = this.byte()
		if(ret > 1) log.warn(new Error('read byte not 0 or 1 for bool'))
		return !!ret
	}

	byte() { return this.buffer.readUInt8(this.position++) }

	bytes(n) { return Buffer.from(this.buffer.slice(this.position, this.position += n)) }

	uint16() {
		const ret = this.buffer.readUInt16LE(this.position)
		this.position += 2
		return ret
	}

	uint32() {
		const ret = this.buffer.readUInt32LE(this.position)
		this.position += 4
		return ret
	}

	uint64() {
		return new Long(this.int32(), this.int32(), true)
	}

	int16() {
		const ret = this.buffer.readInt16LE(this.position)
		this.position += 2
		return ret
	}

	int32() {
		const ret = this.buffer.readInt32LE(this.position)
		this.position += 4
		return ret
	}

	int64() {
		return new Long(this.int32(), this.int32(), false)
	}

	vec3() {
		return { x: this.float(), y: this.float(), z: this.float() }
	}

	angle() {
		return this.int16() / 0x8000 * Math.PI
	}

	float() {
		const ret = this.buffer.readFloatLE(this.position)
		this.position += 4
		return ret
	}

	string() {
		for(var ret = '', c; c = this.uint16(); ret += String.fromCharCode(c));
		return ret
	}
}

class Writeable {
	constructor(length) {
		this.length = length
		this.buffer = Buffer.alloc(this.length)
		this.position = 0
	}

	seek(n) { this.position = n }
	skip(n) { this.position += n }

	bool(b) { this.buffer[this.position++] = !!b }
	byte(n) { this.buffer[this.position++] = n }
	bytes(buf) {
		if(buf) {
			buf.copy(this.buffer, this.position)
			this.position += buf.length
		}
	}
	uint16(n = 0) { this.position = this.buffer.writeUInt16LE(n & 0xffff, this.position) }
	uint32(n = 0) { this.position = this.buffer.writeUInt32LE(n >>> 0, this.position) }
	uint64(obj = {}) {
		if(typeof obj === 'number') {
			if(!Number.isSafeInteger(obj)) log.warn(new Error('unsafe integer was provided'))
			obj = Long.fromNumber(obj, false)
		}
		this.uint32(obj.low)
		this.uint32(obj.high)
	}
	vec3(v = {}) {
		this.float(v.x)
		this.float(v.y)
		this.float(v.z)
	}
	angle(r = 0) { this.int16(Math.round(r / Math.PI * 0x8000)) }
	float(n = 0) { this.position = this.buffer.writeFloatLE(n, this.position) }
	string(str = '') { this.buffer.fill(str + '\0', this.position, this.position += (str.length + 1) * 2, 'ucs2') }
}

Object.assign(Writeable.prototype, {
	int16: Writeable.prototype.uint16,
	int32: Writeable.prototype.uint32,
	int64: Writeable.prototype.uint64
})

module.exports = {
	Readable,
	Writeable
}