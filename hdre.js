/*
*   Alex Rodriguez
*   @jxarco 
*/

// hdre.js 

//main namespace
(function(global){

    /**
     * Main namespace
     * @namespace HDRE
     */
    
    var FLO2BYTE = 4;

    var HDRE = global.HDRE = {

        version: 1.2,
        maxFileSize: 58000 // KBs
    };
    
    HDRE.setup = function(o)
    {
        o = o || {};
        if(HDRE.configuration)
            throw("setup already called");
        HDRE.configuration = o;
    }
    
    // Float32Array -> Float32 -> 32 bits per element -> 4 bytes
    // Float64Array -> Float64 -> 64 bits per element -> 8 bytes
    
    /** HEADER STRUCTURE (164 bytes)
     * Header signature ("HDRE" in ASCII)       4 bytes
     * Format Version                           4 bytes
     * Width                                    2 bytes
     * Height                                   2 bytes
     * Max file size                            2 bytes
     * Number of channels                       1 byte
     * Bits per channel                         1 byte
     * Flags                                    1 byte
     */
    
    /**
    * Write and download an HDRE
    * @method write
    * @param {Object} package
    * @param {Number} width
    * @param {Number} height
    * @param {Number} size buffer size
    */
    HDRE.write = function( package, width, height, size )
    {
        /*
        *   Create header
        */

        // File format information
        var numFaces = 6;
        var numChannels = 4;
        var headerSize = 164; // Bytes
        var contentSize = size * numFaces * numChannels * FLO2BYTE; // Bytes
        var fileSize = headerSize + contentSize; // Bytes
        var bpChannel = 32; // Bits

        var contentBuffer = new ArrayBuffer(fileSize);
        var view = new DataView(contentBuffer);
        
        // Signature: "HDRE" in ASCII
        // 72, 68, 82, 69

        // Set 4 bytes of the signature
        view.setUint8(0, 72);
        view.setUint8(1, 68);
        view.setUint8(2, 82);
        view.setUint8(3, 69);
        view.setUint8(4, 0); // End of string

        // Set 4 bytes of version
        view.setFloat32(5, this.version);

        // Set 2 bytes of width, height and max file size
        view.setUint16(9, width);
        view.setUint16(11, height);
        view.setUint16(13, this.maxFileSize);

        // Set rest of the bytes
        view.setUint8(15, numChannels); // Number of channels
        view.setUint8(16, bpChannel); // Bits per channel

        // Set flags
        // ...

        /*
        *   Create data
        */
        
        var data = new Float32Array(size * numFaces * numChannels);
        var offset = 0;

        for(var i = 0; i < package.length; i++)
        {
            let _env = package[i],
                w = _env.width,
                h = _env.height,
                s = w * h * numChannels;

            var suboff = 0;

            for(var f = 0; f < numFaces; f++) {
                var subdata = _env.pixelData[f];
                data.set( subdata, offset + suboff);
                suboff += subdata.length;
            }

            // Apply offset
            offset += (s * numFaces);
        }

        offset = 164;

        // Set data into the content buffer
        for(var i = 0; i < data.length; i++)
        {
            view.setFloat32(offset, data[i], true);
            offset += 4;
        }

        // Return the ArrayBuffer with the content created
        return contentBuffer;
    }

    /**
    * Read file
    * @method read
    * @param {String} file 
    */
    HDRE.read = function( file )
    {
        var xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.open( "GET", file, true );
        xhr.onload = (e) => { if(e.target.status != 404) parse(e.target.response) };
        xhr.send();
    }

    /**
    * Parse the input data and create texture
    * @method parse
    * @param {ArrayBuffer} buffer 
    * @param {Function} options (oncomplete, onprogress, filename, ...)
    */
    HDRE.parse = function( buffer, options )
    {
        if(!buffer)
        throw( "No data buffer" );

        var options = options || {};
        var fileSizeInKB = buffer.byteLength / 1e3;

        /*
        *   Read header
        */

        // Read signature
        var s = parseString( buffer, 0 );

        // Read version
        var v = parseFloat32(buffer, 5);

        // Set 2 bytes of width, height and max file size
        var w = parseUint16(buffer, 9);
        var h = parseUint16(buffer, 11);
        var m = parseUint16(buffer, 13);

        if(fileSizeInKB > m)
        throw('file not accepted: too big');

        // Set rest of the bytes
        var c = parseUint8(buffer, 15);
        var b = parseUint8(buffer, 16);

        var header = {
            signature: s,
            version: v,
            width: w,
            height: h,
            max_size: m,
            nChannels: c,
            bpChannel: b
        };

        /*
        *   Read data
        */

        var dataBuffer = buffer.slice(164);
        var data = new Float32Array(dataBuffer);
        var numChannels = c;

        var begin = 0, 
            end = w * w * numChannels * 6;
        var ems = [],
            precomputed = [];

        var offset = 0;

        for(var i = 0; i < 6; i++)
        {
            ems.push( data.slice(offset, offset + (w*w*numChannels*6)) );
            offset += (w*w*numChannels*6);
            if(v == 1.0)
                w /= (i == 0) ? 1 : 2;
            else
                w /= 2;
        }

        /*
            Get bytes
        */
        
        // care about new sizes (mip map chain)
        w = header.width;

        for(var i = 0; i < 6; i++)
        {
            var bytes = ems[i];
        
            // Reorder faces
            var faces = [];
            var bPerFace = bytes.length / 6;

            var offset = 0;

            for(var j = 0; j < 6; j++)
            {
                faces[j] = new Float32Array(bPerFace);

                var subdata = bytes.slice(offset, offset + (numChannels * w * w));
                faces[j].set(subdata);

                offset += (numChannels * w * w);
            }

            // order faces
            var facesSorted = [];

            facesSorted.push( 
                faces[0], // X neg
                faces[2], // Y neg
                faces[4], // Z pos
                faces[1], // X pos
                faces[3], // Y pos
                faces[5] // Z neg
            );

            precomputed.push( {
                data: facesSorted,
                width: w
            });

            // resize next textures
            if(v == 1.0)
                w /= (i == 0) ? 1 : 2;
            else
                w /= 2;

            if(options.onprogress)
                options.onprogress( i );
        }

        // return 6 images: original env + 5 levels of roughness
        // pass this to a GL.Texture
        return {header: header, _envs: precomputed};
    }

    /* 
        Private library methods
    */

    function parseString( buffer, offset ) {

        var uintBuffer = new Uint8Array( buffer );
        var endOffset = 0;

        while ( uintBuffer[ offset + endOffset ] != 0 ) 
            endOffset += 1;

        return new TextDecoder().decode(new Uint8Array( buffer ).slice( offset, offset + endOffset ));
    }

    function parseFloat32( buffer, offset ) {
    
        var Float32 = new DataView( buffer.slice( offset, offset + 4 ) ).getFloat32( 0 ).toPrecision(3);
        return Float32;
    }

    function parseUint16( buffer, offset ) {
    
        var Uint16 = new DataView( buffer.slice( offset, offset + 2 ) ).getUint16( 0 );
        return Uint16;
    }

    function parseUint8( buffer, offset ) {
    
        var Uint8 = new DataView( buffer.slice( offset, offset + 1 ) ).getUint8( 0 );
        return Uint8;
    }
    
    //footer
    
    })( typeof(window) != "undefined" ? window : (typeof(self) != "undefined" ? self : global ) );
    
