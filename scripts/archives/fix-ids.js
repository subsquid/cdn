const fs = require('fs')

function populateIds(file) {
    const data = fs.readFileSync(file, 'utf-8')
    const json = JSON.parse(data)
    
    const archives = []
    for (const archive of json.archives) {
        archives.push({
            id: archive.providers[0].dataSourceUrl.split('/').pop(),
            ...archive
        })
    }
    
    fs.writeFileSync(file, JSON.stringify({archives: archives}, null, 2))
}

populateIds('src/archives/evm.json')
populateIds('src/archives/substrate.json')