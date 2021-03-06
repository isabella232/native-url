/*
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import qs from 'querystring';
import format from './format';
import Url from './url';
import { BASE_URL, HOST } from './constants';

const slashedProtocols = /^https?|ftp|gopher|file/;
const urlRegex = /^(.*?)([#?].*)/;
const protocolRegex = /^([a-z0-9.+-]*:)(\/{0,3})(.*)/i;
const slashesRegex = /^([a-z0-9.+-]*:)?\/\/\/*/i;
const ipv6Regex = /^([a-z0-9.+-]*:)(\/{0,2})\[(.*)\]$/i;

function decodePath(url) {
  return url
    .replace(
      /['^|`]/g,
      (char) => '%' + char.charCodeAt().toString(16).toUpperCase()
    )
    .replace(/((?:%[0-9A-F]{2})+)/g, (_, seq) => {
      try {
        const decoded = decodeURIComponent(seq);
        return decoded
          .split('')
          .map((char) => {
            const code = char.charCodeAt();
            if (code > 256 || /^[a-z0-9]$/i.test(char)) {
              return char;
            }
            return '%' + code.toString(16).toUpperCase();
          })
          .join('');
      } catch (_) {
        return seq;
      }
    });
}

export default function (urlStr, parseQs = false, slashesDenoteHost = false) {
  if (urlStr && typeof urlStr === 'object' && urlStr instanceof Url) {
    return urlStr;
  }
  urlStr = urlStr.trim();

  const slashesMatch = urlStr.match(urlRegex);
  if (slashesMatch) {
    urlStr = slashesMatch[1].replace(/\\/g, '/') + slashesMatch[2];
  } else {
    urlStr = urlStr.replace(/\\/g, '/');
  }

  // IPv6 check
  if (ipv6Regex.test(urlStr)) {
    // Add trailing slash to IPV6 urls to match parsing
    if (urlStr.slice(-1) !== '/') urlStr += '/';
  }

  const protocolMatch =
    !/(^javascript)/.test(urlStr) && urlStr.match(protocolRegex);
  let slashes = slashesRegex.test(urlStr);
  let protocolPrefix = '';

  if (protocolMatch) {
    if (!slashedProtocols.test(protocolMatch[1])) {
      // Replace invalid protocol with a valid one for correct parsing
      protocolPrefix = protocolMatch[1].toLowerCase();
      urlStr = `${protocolMatch[2]}${protocolMatch[3]}`;
    }

    if (!protocolMatch[2]) {
      slashes = false;
      if (slashedProtocols.test(protocolMatch[1])) {
        protocolPrefix = protocolMatch[1];
        urlStr = `${protocolMatch[3]}`;
      } else {
        urlStr = `//${protocolMatch[3]}`;
      }
    }

    // Handle '///' in url Eg: http:///s//a/b/c
    // TODO: file:/some/dir/# should become file:///some/dir/# according to the url module in node
    if (protocolMatch[2].length === 3 || protocolMatch[2].length === 1) {
      protocolPrefix = protocolMatch[1];
      urlStr = `/${protocolMatch[3]}`;
    }
  }

  let portMatch = (slashesMatch ? slashesMatch[1] : urlStr).match(
    /^https?:\/\/[^/]+(:[0-9]+)(?=\/|$)/
  );
  let portSuffix = portMatch && portMatch[1];

  let url;
  let res = new Url();
  let err = '';
  let preSlash = '';

  try {
    url = new URL(urlStr);
  } catch (e) {
    err = e;

    // Handle url with slashes - Eg: //some_url
    if (
      !protocolPrefix &&
      !slashesDenoteHost &&
      /^\/\//.test(urlStr) &&
      !/^\/\/.+[@.]/.test(urlStr)
    ) {
      preSlash = '/';
      urlStr = urlStr.substr(1);
    }

    try {
      url = new URL(urlStr, BASE_URL);
    } catch (_) {
      // Unable to parse the url
      // If the URL has only the protocol - Eg: "foo:"
      res.protocol = protocolPrefix;
      res.href = protocolPrefix;
      return res;
    }
  }

  res.slashes = slashes && !preSlash;
  res.host = url.host === HOST ? '' : url.host;
  res.hostname =
    url.hostname === HOST ? '' : url.hostname.replace(/(\[|\])/g, '');
  res.protocol = err ? protocolPrefix || null : url.protocol;

  res.search = url.search.replace(/\\/g, '%5C');
  res.hash = url.hash.replace(/\\/g, '%5C');

  const hashSplit = urlStr.split('#');
  // Handle case when there is a lone '?' in url
  // Eg: http://example.com/?
  if (!res.search && ~hashSplit[0].indexOf('?')) {
    res.search = '?';
  }
  // Similarly handle lone '#' Eg: http://example.com/#
  if (!res.hash && hashSplit[1] === '') {
    res.hash = '#';
  }

  // URLSearchParams is not supported in Edge 16
  // res.query = res.searchParams;
  res.query = parseQs ? qs.decode(url.search.substr(1)) : res.search.substr(1);

  res.pathname =
    preSlash + (protocolMatch ? decodePath(url.pathname) : url.pathname);

  // Chrome parses "#abc" as "about:blank#abc"
  if (res.protocol === 'about:' && res.pathname === 'blank') {
    res.protocol = '';
    res.pathname = '';
  }

  // Partial url that does not start with a /
  // example www.example.com
  if (err && urlStr[0] !== '/') res.pathname = res.pathname.substr(1);

  // Remove additional trailing slashes added by URL
  if (
    protocolPrefix &&
    !slashedProtocols.test(protocolPrefix) &&
    urlStr.slice(-1) !== '/' &&
    res.pathname === '/'
  ) {
    res.pathname = '';
  }

  res.path = res.pathname + res.search;

  res.auth = [url.username, url.password]
    .map(decodeURIComponent)
    .filter(Boolean)
    .join(':');
  res.port = url.port;

  // Make sure to include default ports if they were specified
  if (portSuffix && !res.host.endsWith(portSuffix)) {
    res.host += portSuffix;
    res.port = portSuffix.slice(1);
  }

  res.href = preSlash ? `${res.pathname}${res.search}${res.hash}` : format(res);

  const excludedKeys = /^(file)/.test(res.href) ? ['host', 'hostname'] : [];
  Object.keys(res).forEach((k) => {
    if (!~excludedKeys.indexOf(k)) res[k] = res[k] || null;
  });

  return res;
}
