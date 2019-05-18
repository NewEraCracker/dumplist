#!/usr/bin/env node
/* eslint-disable class-methods-use-this, no-await-in-loop, no-continue, no-new, no-process-exit */
/**
 * Usage: node dumplist.js [--check|--test|--generate|--update|--touchdir]
 *
 * Generates and works with a custom SHA256SUMS file
 * for listing and hashing contents of a directory.
 *
 * @Author  Jorge Oliveira (NewEraCracker)
 * @Date    May 18th 2019
 * @License Public Domain
 * @Version 0.3.4-node
 */

const [crypto, fs, { promisify }] = [require('crypto'), require('fs'), require('util')];
const [access, readdir, readFile, stat, utimes, writeFile] = [promisify(fs.access), promisify(fs.readdir), promisify(fs.readFile), promisify(fs.stat), promisify(fs.utimes), promisify(fs.writeFile)];

const die = (mssg) => {
  console.error(mssg);
  process.exit(1);
};

const file_exists = (path) => {
  return access(path).then(() => true, () => false);
};

const is_writable = (path) => {
  return access(path, fs.constants.W_OK).then(() => true, () => false);
};

const filemtime = async (path) => {
  const stats = await stat(path);
  return Math.floor(stats.mtimeMs / 1000);
};

const md5_file = (filename) => {
  return new Promise((resolve, reject) => {
    const [output, input] = [crypto.createHash('md5'), fs.createReadStream(filename)];

    input.on('error', (err) => {
      reject(err);
    });

    output.once('readable', () => {
      resolve(output.read().toString('hex'));
    });

    input.pipe(output);
  });
};

const sha1_file = (filename) => {
  return new Promise((resolve, reject) => {
    const [output, input] = [crypto.createHash('sha1'), fs.createReadStream(filename)];

    input.on('error', (err) => {
      reject(err);
    });

    output.once('readable', () => {
      resolve(output.read().toString('hex'));
    });

    input.pipe(output);
  });
};

const parity_file = (filename) => {
  return Promise.all([
    md5_file(filename),
    sha1_file(filename)
  ]).then(
    (values) => {
      return Buffer.from((values[0] + values[1]), 'hex')
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    },
    (rejection) => {
      throw rejection;
    }
  );
};

const sha256_file = (filename) => {
  return new Promise((resolve, reject) => {
    const [output, input] = [crypto.createHash('sha256'), fs.createReadStream(filename)];

    input.on('error', (err) => {
      reject(err);
    });

    output.once('readable', () => {
      resolve(output.read().toString('hex'));
    });

    input.pipe(output);
  });
};

const substr_count = (str, char) => {
  let cnt = 0;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) { ++cnt; }
  }

  return cnt;
};

const { basename, dirname } = require('path');

/** Utility static methods for dump listing */
class NewEra_DumpListUtil {

  /**
   * This will parse a listfile
   */
  async parse_listfile (filename) {

    const [fileproperties, comment, content] = [{}, {mtime: [], parity: [], name: []}, {sha256: [], name: []}];

    if (!await file_exists(filename)) {
      console.error('Error parsing listfile: File does not exist');
      return false;
    }

    const filecontents = await readFile(filename, {encoding: 'utf8'});

    filecontents.replace(/^; ([0-9]+) ([\w\d_-]{48}) ([*][^\r\n]+)/gm, (...m) => {
      comment.mtime.push(m[1]);
      comment.parity.push(m[2]);
      comment.name.push(m[3]);
    });

    if (!comment.mtime.length)
    {
      console.error('Error parsing listfile: Unable to parse comments');
      return false;
    }

    filecontents.replace(/^([0-9a-f]{64}) ([*][^\r\n]+)/gm, (...m) => {
      content.sha256.push(m[1]);
      content.name.push(m[2]);
    });

    if (!content.sha256.length) {
      console.error('Error parsing listfile: Unable to parse contents');
      return false;
    }

    if (comment['name'].length === content['name'].length) {

      for (let i = 0; i < comment['name'].length; i++) {

        if (comment['name'][i][0] == '*' && comment['name'][i] === content['name'][i]) {

          // Not an hack: We have to remove the asterisk in begining and restore ./ in path for Node.js to be able to work it out
          const file = './' + comment['name'][i].substr(1);

          fileproperties[`${file}`] = {
            'mtime': comment['mtime'][i],
            'parity': comment['parity'][i],
            'sha256': content['sha256'][i]
          };
        } else {
          console.error('Error parsing listfile: Invalid entry order');
          return false;
        }
      }
    } else {
      console.error('Error parsing listfile: Invalid entry count');
      return false;
    }

    return fileproperties;
  }

  /** This will generate a listfile */
  generate_listfile (fileproperties) {

    // Init contents of list file
    let [comment, content] = ['', ''];

    // Sort file properties array and walk
    for (const file of Object.keys(fileproperties).sort(NewEra_Compare.prototype.sort_files_by_name)) {
      const properties = fileproperties[`${file}`];

      // Not an hack: We have to replace ./ in path by an asterisk for other applications (QuickSFV, TeraCopy...) to be able to work it out
      const filename = '*' + file.substr(2);

      comment += `; ${properties['mtime']} ${properties['parity']} ${filename}\n`;
      content += properties['sha256'] + ' ' + filename + "\n";
    }

    return (comment + content);
  }

  /** Array with the paths a dir contains */
  async readdir_recursive (dir = '.', show_dirs = false, ignored = []) {

    // Set types for stack and return value
    const [stack, result] = [[], []];

    // Initialize stack
    stack.push(dir);

    // Pop the first element of stack and evaluate it (do this until stack is fully empty)
    while (dir = stack.shift()) { // eslint-disable-line no-cond-assign

      const files = await readdir(dir);

      for (let path of files) {

        // Prepend dir to current path
        path = dir + '/' + path;

        // Stat the path to determine attributes
        const stats = await stat(path);

        if (stats.isDirectory()) {

          // Check ignored dirs
          if (Array.isArray(ignored) && ignored.length && ignored.indexOf(path + '/') !== -1) { continue; }

          // Add dir to stack for reading
          stack.push(path);

          // If show_dirs is true, add dir path to result
          if (show_dirs) { result.push(path); }

        } else if (stats.isFile()) {

          // Check ignored files
          if (Array.isArray(ignored) && ignored.length && ignored.indexOf(path) !== -1) { continue; }

          // Add file path to result
          result.push(path);
        }
      }
    }

    // Sort the array using simple ordering
    result.sort();

    // Now we can return it
    return result;
  }
}

/* Useful comparators */
class NewEra_Compare {

  /* Ascending directory sorting by names */
  sort_files_by_name (a, b) {

    /* Equal */
    if (a == b) { return 0; }

    /* Let strcmp decide */
    return (( a > b ) ? 1 : -1 );
  }

  /* Ascending directory sorting by levels and names */
  sort_files_by_level_asc (a, b) {

    /* Equal */
    if (a == b) { return 0; }

    /* Check dir levels */
    const la = substr_count(a, '/');
    const lb = substr_count(b, '/');

    /* Prioritize levels, in case of equality let sorting by names decide */
    return ((la < lb) ? -1 : ((la == lb) ? NewEra_Compare.prototype.sort_files_by_name(a, b) : 1));
  }

  /* Reverse directory sorting by levels and names */
  sort_files_by_level_dsc (a, b) {

    return NewEra_Compare.prototype.sort_files_by_level_asc(b, a);
  }
}

/** Methods used in dump listing */
class NewEra_DumpList {

  /** Construct the object and perform actions */
  constructor (listfile = './SHA256SUMS', ignored = []) {

    /** The file that holds the file list */
    this.listfile = listfile;

    /** Ignored paths */
    this.ignored = [
      listfile,   /* List file */
      ...ignored  /* Original ignored array */
     ];

    /** Simple file list array */
    this.filelist = [];

    /** Detailed file list array */
    this.fileproperties = [];

    // Check arguments count
    if (process.argv.length != 3) {
      die('Usage: node ' + basename(__filename) + " [--check|--test|--generate|--update|--touchdir]");
    }

    // Fix argument
    const argument = process.argv[2].replace(/^[-]{1,2}/g, '');

    // Process arguments
    switch(argument) {
      case 'test':
        this.dumplist_check(true, true);
        break;
      case 'check':
        this.dumplist_check(false, false);
        break;
      case 'generate':
        this.dumplist_generate();
        break;
      case 'update':
        this.dumplist_update();
        break;
      case 'touchdir':
        this.dumplist_touchdir();
        break;
      default:
        die('Usage: node ' + basename(__filename) + " [--check|--test|--generate|--update|--touchdir]");
    }
  }

  /** Run the check on each file */
  async dumplist_check (testsha256 = false, testparity = false) {

    this.filelist = await NewEra_DumpListUtil.prototype.readdir_recursive('.', false, this.ignored);
    this.fileproperties = await NewEra_DumpListUtil.prototype.parse_listfile(this.listfile);

    if (!this.fileproperties) { return; }

    for (const file of this.filelist) {

      // Handle creation case
      if (!this.fileproperties.hasOwnProperty(file)) {
        console.log(`${file} is a new file.`);
        continue;
      }
    }

    for (const file of Object.keys(this.fileproperties)) {
      const properties = this.fileproperties[`${file}`];

      // Handle deletion
      if (!await file_exists(file)) {
        console.log(`${file} does not exist.`);
        continue;
      }

      // Handle file modification
      if (await filemtime(file) != properties['mtime']) {
        console.log(`${file} was modified.`);
        continue;
      }

      // Test file parity if required
      if (testparity) {
        const parity = await parity_file(file);

        if (parity != properties['parity']) {
          console.log(`${file} Expected parity: ${properties['parity']} Got: ${parity}.`);
          continue;
        }
      }

      // Test file sha256 if required
      if (testsha256) {
        const sha256 = await sha256_file(file);

        if (sha256 != properties['sha256']) {
          console.log(`${file} Expected sha256: ${properties['sha256']} Got: ${sha256}.`);
          continue;
        }
      }
    }
  }

  /** Generate dump file listing */
  async dumplist_generate () {

    this.filelist = await NewEra_DumpListUtil.prototype.readdir_recursive('.', false, this.ignored);
    this.fileproperties = {};

    for (const file of this.filelist) {
      this.fileproperties[`${file}`] = {
        mtime: await filemtime(file),
        parity: await parity_file(file),
        sha256: await sha256_file(file)
      };
    }

    const contents = NewEra_DumpListUtil.prototype.generate_listfile(this.fileproperties);
    await writeFile(this.listfile, contents);
  }

  /** Update dump file listing */
  async dumplist_update () {

    this.filelist = await NewEra_DumpListUtil.prototype.readdir_recursive('.', false, this.ignored);
    this.fileproperties = await NewEra_DumpListUtil.prototype.parse_listfile(this.listfile);

    if (!this.fileproperties) { return; }

    for (const file of this.filelist) {

      // Handle creation case
      if (!this.fileproperties.hasOwnProperty(file))
      {
        this.fileproperties[`${file}`] = {
          'mtime': await filemtime(file),
          'parity': await parity_file(file),
          'sha256': await sha256_file(file)
        };
        continue;
      }
    }

    // Save the keys to remove in case there is file deletion
    const keys_to_remove = [];

    // Handle each file in the properties list
    for (const file of Object.keys(this.fileproperties)) {
      const properties = this.fileproperties[`${file}`];

      // Handle deletion (Save it, will delete the keys later)
      if (!await file_exists(file)) {
        keys_to_remove.push(file);
        continue;
      }

      // Handle file modification
      if (await filemtime(file) != properties['mtime']) {
        this.fileproperties[`${file}`] = {
          'mtime': await filemtime(file),
          'parity': await parity_file(file),
          'sha256': await sha256_file(file)
        };
        continue;
      }
    }

    // Handle deletion (Delete the keys now)
    if (keys_to_remove.length > 0) {
      for (const key of keys_to_remove) {
        this.fileproperties[key] = null;
        delete this.fileproperties[key];
      }
    }

    const contents = NewEra_DumpListUtil.prototype.generate_listfile(this.fileproperties);
    await writeFile(this.listfile, contents);
  }

  async dumplist_touchdir () {

    // Filelist including directories
    const list = await NewEra_DumpListUtil.prototype.readdir_recursive('.', true, this.ignored);

    // Easier with a bottom to top approach
    list.sort(NewEra_Compare.prototype.sort_files_by_level_dsc);

    // Handle list including directories. Then run
    // another pass with list without directories
    for (let i = 0; i < 2; i++) {

      // Reset internal variables state
      let [dir, time] = [null, null];

      // Handle list
      for (const file of list) {

        // Ignore dir dates on pass two
        if (i === 1 && (await stat(file)).isDirectory()) {
          continue;
        }

        // Blacklist certain names
        if (file.toLowerCase().indexOf('/desktop.ini') !== -1 || file.indexOf('/.') != -1) {
          continue;
        }

        // Reset internal variables state when moving to another dir
        if (dir !== dirname(file)) {
          dir  = dirname(file);
          time = 0;
        }

        // Save current time
        const mtime = await filemtime(file);

        // Only update when mtime is correctly set and higher than time
        // Also check for writability to prevent errors
        if (mtime > 0 && mtime > time && is_writable(dir)) {

          // Save new timestamp
          time = mtime;

          // Update timestamp
          await utimes(dir, time, time);
        }
      }
    }

    // I think we should be OK
    return true;
  }
}

/** Run */
new NewEra_DumpList('./SHA256SUMS', ['./.htaccess', './.htpasswd']);