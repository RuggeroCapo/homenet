import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInfo, parseModem, parseSms } from './router.js';

test('parses Quectel AT output', () => {
  const m = parseModem({
    method: 'at',
    csq: '+CSQ: 23,99',
    cops: '+COPS: 0,0,"TIM",7',
    qeng: '+QENG: "servingcell","NOCONN","LTE","FDD",222,01,1A2B3C4,123,1850,3,5,5,ABCD,-95,-9,-65,14,30',
    qnwinfo: '+QNWINFO: "FDD LTE","22201","LTE BAND 3",1850',
  })!;
  assert.equal(m.operator, 'TIM');
  assert.equal(m.tech, 'LTE');
  assert.equal(m.band, 'B3');
  assert.equal(m.rsrp, -95);
  assert.equal(m.rsrq, -9);
  assert.equal(m.sinr, 14);
  assert.equal(m.quality, 63);
});

test('parses 3GPP CESQ when no vendor command is available', () => {
  const m = parseModem({ method: 'at', csq: '+CSQ: 99,99', cesq: '+CESQ: 99,99,255,255,24,46', cops: '' })!;
  assert.equal(m.rssi, undefined);
  assert.equal(m.rsrp, -95);
  assert.equal(m.rsrq, -8);
});

test('parses uqmi signal info', () => {
  const m = parseModem({ method: 'uqmi', signal: { type: 'lte', rssi: -67, rsrq: -9, rsrp: -95, snr: 13.4 }, serving: { registration: 'registered', plmn_description: 'Iliad' } })!;
  assert.deepEqual([m.tech, m.rsrp, m.sinr, m.operator, m.registered], ['LTE', -95, 13.4, 'Iliad', true]);
});

test('detects WAN interfaces, LAN subnets and WAN counters', () => {
  const info = parseInfo({
    board: {}, system: { uptime: 100 }, netdev: { wwan0: [1000, 200], eth0: [5, 5] },
    ifaces: {
      interface: [
        { interface: 'lan', up: true, proto: 'static', l3_device: 'br-lan', 'ipv4-address': [{ address: '192.168.1.1', mask: 24 }], 'ipv6-prefix-assignment': [{ address: '2a01:db8:1::', mask: 64 }] },
        { interface: 'lte', up: true, proto: 'qmi', l3_device: 'wwan0', route: [{ target: '0.0.0.0', mask: 0 }] },
        { interface: 'wwan', up: false, proto: 'dhcp', device: 'phy0-sta0' },
        { interface: 'loopback', up: true, proto: 'static', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }] },
      ],
    },
  });
  assert.deepEqual(info.wan.map((w) => [w.iface, w.kind, w.isDefault]), [['lte', 'lte', true], ['wwan', 'wifi', false]]);
  assert.deepEqual(info.lan4, [['192.168.1.1', 24]]);
  assert.deepEqual(info.lan6, [['2a01:db8:1::', 64]]);
  assert.deepEqual(info.wanCounters, { rx: 1000, tx: 200 });
});

test('merges multipart SMS from sms_tool', () => {
  const sms = parseSms({ msg: [
    { index: 0, sender: 'TIM', timestamp: '10/10/26 09:12:44', content: 'Ciao' },
    { index: 1, sender: '40916', timestamp: '11/10/26 07:30:02', reference: 12, part: 2, total: 2, content: ' mondo' },
    { index: 2, sender: '40916', timestamp: '11/10/26 07:30:01', reference: 12, part: 1, total: 2, content: 'Hello' },
    { index: 3, error: 'error decoding pdu', sender: '', timestamp: '', content: '' },
  ] });
  assert.equal(sms.length, 2);
  assert.equal(sms[1].content, 'Hello mondo');
  assert.equal(sms[1].timestamp, '11/10/26 07:30:01');
});
