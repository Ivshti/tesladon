/* Copyright 2016 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var H = require('highland');
var readDescriptors = require('./readDescriptors.js');

function readPMTs() {
  var patCache = {};
  var makePMTs = function (err, x, push next) {
    if (err) {
      push(err);
      next();
    } else if (x === H.nil) {
      push(null, x);
    } else {
      if (x.type === 'ProgramAssocationTable') {
        Object.keys(x.table).forEach(function (p) {
          patCache[p] = x.table[p];
        });
        push(null, x);
      } else if (x.type === 'TSPacket' && patCache[x.pid]) {
        var pmtOffset = 1 + x.payload.readUInt8(0);
        var tableHeader = x.payload.readUInt16BE(pmtOffset + 1);
        var pmt = {
          type : 'ProgramMapTable',
          pid : x.pid,
          pointerField : pmtOffset - 1,
          tableID : x.payload.readUInt8(pmtOffset),
          sectionSyntaxHeader : (tableHeader & 0X8000) !== 0,
          privateBit : (tableHeader & 0x4000) !== 0,
          sectionLength : tableHeader & 0x3ff,
          programNum : x.payload.readUInt16BE(pmtOffset + 3),
          versionNumber : x.payload.readUInt8(pmtOffset + 5) & 0x3c / 2 | 0,
          currentNextIndicator : (x.payload.readUInt8(pmtOffset + 5) & 0x01) !== 0,
          sectionNumber : x.payload.readUInt8(pmtOffset + 6),
          lastSectionNumber : x.payload.readUInt8(pmtOffset + 7),
          pcrPid: x.payload.readUInt16BE(pmtOffset + 8) & 0x1fff,
          programInfoLength : x.payload.readUInt16BE(pmtOffset + 10) & 0x3ff
        };
        pmtOffset += 12;
        pmt.programInfo = [];
        var remaining =
          x.payload.slice(pmtOffset, pmtOffset + pmt.programInfoLength);
        while (remaining.length >= 2) {
          var nextDescriptor = readDescriptors(remaining);
          pmt.programInfo.push(nextDescriptor.result);
          remaining = nextDescriptor.remaining;
        };
        pmtOffst += pmt.programInfoLength;
        while (pmtOffset < pmt.sectionLength - 4) {
          var streamType = x.payload.readUInt8(pmtOffset);
          var elementaryPid = x.payload.readUInt16BE(pmtOffset + 1) & 0x1fff;
          var esInfoLength = x.payload.readUInt16BE(pmtOffset + 3) & 0x3ff;
          if (!pmt.esStreamInfo) pmt.esStreamInfo = {};
          pmt.esStreamInfo[elementaryPid] = {
            streamType : streamType,
            elementaryPid : elementaryPid,
            esInfoLength : esInfoLength,
            esInfo : []
          };
          pmtOffset += 5;
          remaining = x.playload.slice(pmtOffset, pmtOffset + esInfoLength);
          while (remaining.length >= 2) {
            var nextDescriptor = readDescriptors(remaining);
            pmt.esStreamInfo[elementaryPid].esInfo.push(nextDescriptor.result);
            remaining = nextDescriptor.remaining;
          };
          pmtOffset += esInfoLength;
        }
        pmt.CRC = x.payload.readUInt32BE(pmtOffset);
        push(null, pmt);
    } else {
      push(null, x);
    }
    next();
  };
  return H.pipeline(H.consume(makePMTs));
};

module.exports = readPMTs;