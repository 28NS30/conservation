import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../utils/supabase'
import SelectionMap from './SelectionMap.jsx'

export default function ReportForm() {
    const [location, setLocation] = useState()
    const [fireLocation, setFireLocation] = useState()
    const report_type = useRef()
    const image = useRef()
    const notes = useRef()

    useEffect(()=>{
        if (!navigator.geolocation) {
            return;
        }

        const handleSuccess = (pos) => {
            setLocation([pos.coords.longitude, pos.coords.latitude])
        };

        const handleError = (err) => {
          alert(err.message);
        };

        let location = navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        });
    }, [])

    /*
     * Signs in as a single shared account so submissions satisfy row-level
     * security.
     *
     * The credentials used to be written here in the source. That put a working
     * password in a public repository AND in the client bundle, where anyone who
     * opens devtools on the deployed site can read it — a bundled secret is not
     * a secret, whatever it is stored in. Moving it to an environment variable
     * keeps it out of git; it does NOT keep it out of the shipped JavaScript,
     * because anything the browser can use, the browser can show.
     *
     * The real fix is for reports to be inserted by something the visitor does
     * not hold the keys to — an anon-insert policy scoped to this table, or a
     * server-side endpoint — at which point this function disappears entirely.
     */
    const handleSignIn = async () => {
        const email = import.meta.env.VITE_REPORTER_EMAIL
        const password = import.meta.env.VITE_REPORTER_PASSWORD
        if (!supabase || !email || !password) {
            console.error('Reporter credentials are not configured; the report cannot be submitted.')
            return null
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) console.error('Error signing in:', error.message)
        return data
    }

    async function handleSubmit(e) {
        e.preventDefault()

        if(report_type.current.value == "") {
            alert("Por favor especifica tu distancia al incendio.")
            return
        }
        if(fireLocation == undefined) {
            alert("Por favor estima la ubicación del incendio en el mapa.")
            return
        }
        if(location == undefined) {
            alert("Por favor permite que se utilize tu ubicación.")
        }
        if(image.current.files.length == 0) {
            alert("Por favor agregue una foto del incendio.")
        }

        let signInData = await handleSignIn()
        const imageFile = image.current.files[0]
        const imagePath = `${Date.now()}_report`

        const { data: uploadData, error: uploadError } = await supabase.storage.from('images').upload(imagePath, imageFile, {
            cacheControl: '3600',
            upsert: false
        })

        if (uploadError) {
            console.error('Upload failed:', uploadError.message)
            return null
        }

        const { data: urlData } = supabase.storage.from('images').getPublicUrl(imagePath)

        const error = await supabase.from('reports').insert({
            report_type: report_type.current.value,
            data: {
                "fire_location": fireLocation,
                "current_location": location
            },
            image: urlData.publicUrl,
            notes: notes.current.value
        })
        if(error) {
            console.error(error)
            return
        }
        
    }

    return (
        <div className='flex flex-row gap-2'>
            <form className='flex flex-col items-center gap-2 p-5' onSubmit={handleSubmit}>
                <label htmlFor="report_type" className='relative top-1 text-white font-bold'>¿Que tan cerca estas al incendio?</label>
                <select name="report_type" className='w-90 h-7 bg-white' id='report_type' ref={report_type}>
                    <option value="">Selecciona una opción..</option>
                    <option value="red">Estoy cerca a la llama 🔴</option>
                    <option value="orange">Estoy dentro de la zona del humo 🟠</option>
                    <option value="yellow">Veo de lejos el humo o el brillo de la llama 🟡</option>
                </select>
                <label htmlFor="photo" className=' text-white relative top-1 font-bold'>Toma una foto(opcional)</label>
                <input id='photo' type="file" accept="image/*" capture="environment" className='w-60 bg-white rounded' ref={image}></input>
                <label htmlFor="notes" className='font-bold text-white relative top-1'>Informacion Adicional:</label>
                <textarea name="var_1" rows="2" cols="40" wrap="soft" className='bg-white rounded' ref={notes}></textarea>
                <input type="submit" value="Submit" className='bg-white hover:bg-gray-200 w-30 h-8 rounded' />
            </form>
            <div className='flex flex-col items-center'>
                <SelectionMap setLocation={setFireLocation} style='w-120 h-80 rounded m-5'/>
                <p className='text-white font-bold relative bottom-3'>Marca la ubicación estimada del incendio</p>
            </div>
        </div>
        
    )
}